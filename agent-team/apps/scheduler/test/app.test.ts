// Checks the HTTP scaffold.
import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
import { after, test } from "node:test"
import { createApp } from "../src/app.js"

const server = createApp().listen(0, "127.0.0.1")
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

test("generic state endpoints are not available", async () => {
  for (const method of ["GET", "PUT"]) {
    assert.equal((await request("/state/example", { method })).status, 404)
  }
})
