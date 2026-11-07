// Exercises the real entry point against a local fake board, not the user's Vikunja server.
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

const projectDirectory = fileURLToPath(new URL("..", import.meta.url))

test("index.ts continuously retries failed passes and shuts down cleanly", { timeout: 15_000 }, async (t) => {
  let boardRequests = 0
  const board = createServer((request, response) => {
    boardRequests += 1
    assert.equal(request.url, "/api/v1/projects/3/views/12/tasks?page=1&per_page=50")
    assert.equal(request.headers.authorization, "Bearer test-token")
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify([{ id: 1, title: "Ready", count: 1, tasks: [{ id: 42, title: "Build a form", priority: 1 }] }]))
  })
  board.listen(0, "127.0.0.1")
  await once(board, "listening")
  t.after(async () => {
    board.closeAllConnections()
    await new Promise<void>((resolve) => board.close(() => resolve()))
  })

  // Reserve a free port without hard-coding a port that the user may already be using.
  const portHolder = createServer()
  portHolder.listen(0, "127.0.0.1")
  await once(portHolder, "listening")
  const port = (portHolder.address() as AddressInfo).port
  await new Promise<void>((resolve) => portHolder.close(() => resolve()))

  const directory = mkdtempSync(join(tmpdir(), "scheduler-startup-test-"))
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      SCHEDULER_DB_PATH: join(directory, "scheduler.sqlite"),
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
  await new Promise<void>((resolve, reject) => {
    const receive = (chunk: Buffer) => {
      output += chunk.toString()
      if ((output.match(/scheduler pass failed:/g) ?? []).length >= 2) {
        resolve()
      }
    }
    child.stdout.on("data", receive)
    child.stderr.on("data", receive)
    child.once("error", reject)
    child.once("exit", () => reject(new Error(`Scheduler exited before its startup pass: ${output}`)))
  })

  assert.match(output, /SchedulerDatabase.saveTicket is not implemented/)
  const response = await fetch(`http://127.0.0.1:${port}/health`)
  assert.deepEqual(await response.json(), { ok: true, service: "scheduler" })
  child.kill("SIGTERM")
  const [code, signal] = await exited
  assert.equal(code, 0)
  assert.equal(signal, null)
  assert.ok(boardRequests >= 2)
})
