// Checks the HTTP scaffold and verifies SQLite state survives reopening the database.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import { after, test } from "node:test"
import { createApp } from "../src/app.js"
import { StateStore } from "../src/state-store.js"

const store = new StateStore(":memory:")
const server = createApp(store).listen(0, "127.0.0.1")
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
  store.close()
})

test("health identifies the scheduler", async () => {
  const response = await request("/health")

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, service: "scheduler" })
})

test("state can be saved, read and overwritten, including null", async () => {
  for (const value of [{ paused: true }, null]) {
    const saved = await request("/state/example", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    })
    assert.equal(saved.status, 200)
    assert.deepEqual(await saved.json(), { key: "example", value })

    const read = await request("/state/example")
    assert.equal(read.status, 200)
    assert.deepEqual(await read.json(), { key: "example", value })
  }
})

test("missing state and invalid bodies return client errors", async () => {
  assert.equal((await request("/state/missing")).status, 404)

  for (const body of ["{}", "{invalid"]) {
    const response = await request("/state/invalid", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    })
    assert.equal(response.status, 400)
  }

  assert.equal((await request("/state/invalid")).status, 404)
})

test("SQLite retains state after the database is closed and reopened", () => {
  const directory = mkdtempSync(join(tmpdir(), "scheduler-test-"))
  const path = join(directory, "nested", "state.sqlite")

  try {
    const first = new StateStore(path)
    try {
      first.set("run", { ticketId: 42, status: "ready" })
    } finally {
      first.close()
    }

    const reopened = new StateStore(path)
    try {
      assert.deepEqual(reopened.get("run"), { ticketId: 42, status: "ready" })
      assert.equal(reopened.get("missing"), undefined)
    } finally {
      reopened.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
