// Exercises the real entry point against a local fake board, not the user's server.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { AgentStore } from "../src/db/agent-store.js"
import { AssignmentStore } from "../src/db/assignment-store.js"
import { openDatabase } from "../src/db/database.js"
import { TicketStore } from "../src/db/ticket-store.js"

const projectDirectory = fileURLToPath(new URL("..", import.meta.url))

for (const hasAgent of [false, true]) {
  const name = hasAgent
    ? "index.ts retries a failed card move without duplicate assignments and shuts down cleanly"
    : "index.ts keeps polling without agents and shuts down cleanly"

  test(name, { timeout: 15_000 }, async (t) => {
    let boardRequests = 0
    let moveRequests = 0
    let moved = false
    let ready!: () => void
    const progressed = new Promise<void>((resolve) => { ready = resolve })
    const board = createServer(async (request, response) => {
      assert.equal(request.headers.authorization, "Bearer test-token")
      response.setHeader("Content-Type", "application/json")
      if (request.method === "POST") {
        assert.equal(request.url, "/api/v1/projects/3/views/12/buckets/7/tasks")
        let body = ""
        for await (const chunk of request) {
          body += chunk.toString()
        }
        assert.deepEqual(JSON.parse(body), { task_id: 42, bucket_id: 7, project_view_id: 12, project_id: 3 })
        moveRequests += 1
        // First move fails after local ownership has already been saved.
        if (moveRequests === 1) {
          response.statusCode = 500
          response.end(JSON.stringify({ error: "temporary failure" }))
        } else {
          moved = true
          response.end("{}")
        }
        return
      }

      assert.equal(request.method, "GET")
      assert.equal(request.url, "/api/v1/projects/3/views/12/tasks?page=1&per_page=50")
      boardRequests += 1
      const task = { id: 42, title: "Build a form", priority: 1 }
      response.end(JSON.stringify([
        { id: 1, title: "Ready", count: moved ? 0 : 1, tasks: moved ? null : [task] },
        { id: 7, title: "In progress", count: moved ? 1 : 0, tasks: moved ? [task] : null },
      ]))
      if (hasAgent ? moved : boardRequests >= 3) {
        ready()
      }
    })
    board.listen(0, "127.0.0.1")
    await once(board, "listening")
    t.after(async () => {
      board.closeAllConnections()
      await new Promise<void>((resolve) => board.close(() => resolve()))
    })

    const portHolder = createServer()
    portHolder.listen(0, "127.0.0.1")
    await once(portHolder, "listening")
    const port = (portHolder.address() as AddressInfo).port
    await new Promise<void>((resolve) => portHolder.close(() => resolve()))

    const directory = mkdtempSync(join(tmpdir(), "scheduler-startup-test-"))
    const databasePath = join(directory, "scheduler.sqlite")
    const initialDatabase = openDatabase(databasePath)
    if (hasAgent) {
      new AgentStore(initialDatabase).create({ name: "frontend-1", status: "idle" })
    }
    initialDatabase.close()

    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: projectDirectory,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        SCHEDULER_DB_PATH: databasePath,
        SCHEDULER_POLL_MS: "20",
        VIKUNJA_URL: `http://127.0.0.1:${(board.address() as AddressInfo).port}`,
        VIKUNJA_API_TOKEN: "test-token",
        VIKUNJA_PROJECT_ID: "3",
        VIKUNJA_VIEW_ID: "12",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const exited = once(child, "exit")
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL")
        await exited
      }
      rmSync(directory, { recursive: true, force: true })
    })

    let output = ""
    const receive = (chunk: Buffer) => { output += chunk.toString() }
    child.stdout.on("data", receive)
    child.stderr.on("data", receive)
    await Promise.race([
      progressed,
      exited.then(() => { throw new Error(`Scheduler exited before progressing: ${output}`) }),
    ])

    const response = await fetch(`http://127.0.0.1:${port}/health`)
    assert.deepEqual(await response.json(), { ok: true, service: "scheduler" })
    child.kill("SIGTERM")
    const [code, signal] = await exited
    assert.equal(code, 0)
    assert.equal(signal, null)
    assert.doesNotMatch(output, /not implemented/)

    const database = openDatabase(databasePath)
    try {
      assert.deepEqual(new TicketStore(database).list().map((ticket) => ({ ...ticket })), [
        { id: 1, vikunjaTaskId: 42, title: "Build a form", status: hasAgent ? "In progress" : "Ready", priority: 1 },
      ])
      const assignments = new AssignmentStore(database).list()
      assert.equal(assignments.length, hasAgent ? 1 : 0)
      if (hasAgent) {
        assert.equal(moveRequests, 2)
        assert.equal(assignments[0].ticketId, 1)
        assert.equal(assignments[0].agentId, 1)
        assert.equal(assignments[0].status, "running")
        assert.equal(assignments[0].completedAt, null)
        assert.equal(new AgentStore(database).get(1)?.status, "busy")
        assert.match(output, /scheduler pass failed:.*Vikunja POST .*HTTP 500/)
      } else {
        assert.equal(moveRequests, 0)
        assert.doesNotMatch(output, /scheduler pass failed:/)
      }
    } finally {
      database.close()
    }
  })
}
