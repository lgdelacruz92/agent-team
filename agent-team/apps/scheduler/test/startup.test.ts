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
    ? "index.ts assigns multiple ready tickets without moving cards or duplicating assignments"
    : "index.ts keeps polling without agents and shuts down cleanly"

  test(name, { timeout: 15_000 }, async (t) => {
    let boardRequests = 0
    let unexpectedRequests = 0
    let ready!: () => void
    const progressed = new Promise<void>((resolve) => { ready = resolve })
    const board = createServer(async (request, response) => {
      assert.equal(request.headers.authorization, "Bearer test-token")
      response.setHeader("Content-Type", "application/json")
      if (request.method !== "GET") {
        unexpectedRequests += 1
        response.statusCode = 405
        response.end("{}")
        return
      }

      assert.equal(request.method, "GET")
      assert.equal(request.url, "/api/v1/projects/3/views/12/tasks?page=1&per_page=50")
      boardRequests += 1
      const tasks = [
        { id: 42, title: "Build a form", priority: 1 },
        { id: 43, title: "Build a page", priority: 2 },
      ]
      response.end(JSON.stringify([
        { id: 1, title: "Ready", count: tasks.length, tasks },
        { id: 7, title: "In progress", count: 0, tasks: null },
      ]))
      if (boardRequests >= 4) {
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
      new AgentStore(initialDatabase).create({ name: "frontend-2", status: "idle" })
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
        { id: 1, vikunjaTaskId: 42, title: "Build a form", status: "Ready", priority: 1, presentOnBoard: true },
        { id: 2, vikunjaTaskId: 43, title: "Build a page", status: "Ready", priority: 2, presentOnBoard: true },
      ])
      const assignments = new AssignmentStore(database).list()
      assert.equal(assignments.length, hasAgent ? 2 : 0)
      assert.equal(unexpectedRequests, 0)
      if (hasAgent) {
        assert.equal(assignments[0].ticketId, 1)
        assert.equal(assignments[0].agentId, 1)
        assert.equal(assignments[0].status, "assigned")
        assert.equal(assignments[0].completedAt, null)
        assert.equal(assignments[1].ticketId, 2)
        assert.equal(assignments[1].agentId, 2)
        assert.equal(new AgentStore(database).get(1)?.status, "idle")
      }
      assert.doesNotMatch(output, /scheduler pass failed:/)
    } finally {
      database.close()
    }
  })
}
