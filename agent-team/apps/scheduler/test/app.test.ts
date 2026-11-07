// Checks the HTTP scaffold.
import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
import { after, test } from "node:test"
import { createApp } from "../src/app.js"
import { SchedulerStatus } from "../src/components/scheduler-status.js"

let runPass: () => Promise<void> = async () => {}
const status = new SchedulerStatus({ runOnce: () => runPass() }, () => new Date("2026-11-07T12:00:00.000Z"))
const server = createApp(status).listen(0, "127.0.0.1")
const listening = new Promise<void>((resolve, reject) => {
  server.once("listening", resolve)
  server.once("error", reject)
})

async function request(path: string, options?: RequestInit): Promise<Response> {
  await listening
  const address = server.address() as AddressInfo

  return fetch(`http://127.0.0.1:${address.port}${path}`, options)
}

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
    server.closeAllConnections()
  })
})

test("health identifies the scheduler", async () => {
  const response = await request("/health")

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, service: "scheduler" })
})

test("status starts empty before the first pass", async () => {
  const response = await request("/status")
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    running: false, lastSucceededAt: null, lastFailedAt: null, lastResult: null,
  })
})

test("status reports an active pass and a successful completion", async () => {
  let finish!: () => void
  runPass = () => new Promise<void>((resolve) => { finish = resolve })
  const pass = status.runOnce()
  assert.deepEqual(await (await request("/status")).json(), {
    running: true, lastSucceededAt: null, lastFailedAt: null, lastResult: null,
  })
  finish()
  await pass
  assert.deepEqual(await (await request("/status")).json(), {
    running: false, lastSucceededAt: "2026-11-07T12:00:00.000Z", lastFailedAt: null, lastResult: "success",
  })
})

test("status reports a failed pass without changing liveness or exposing errors", async () => {
  const error = new Error("private failure details")
  runPass = async () => { throw error }
  await assert.rejects(status.runOnce(), (actual) => actual === error)
  assert.deepEqual(await (await request("/status")).json(), {
    running: false, lastSucceededAt: "2026-11-07T12:00:00.000Z",
    lastFailedAt: "2026-11-07T12:00:00.000Z", lastResult: "failure",
  })
  assert.deepEqual(await (await request("/health")).json(), { ok: true, service: "scheduler" })
})

test("status records recovery and retains the last failure time", async () => {
  runPass = async () => {}
  await status.runOnce()
  assert.deepEqual(await (await request("/status")).json(), {
    running: false, lastSucceededAt: "2026-11-07T12:00:00.000Z",
    lastFailedAt: "2026-11-07T12:00:00.000Z", lastResult: "success",
  })
  const snapshot = status.snapshot()
  snapshot.running = true
  assert.equal(status.snapshot().running, false)
})

test("generic state endpoints are not available", async () => {
  for (const method of ["GET", "PUT"]) {
    assert.equal((await request("/state/example", { method })).status, 404)
  }
})
