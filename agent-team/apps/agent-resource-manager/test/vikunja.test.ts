// Exercises Vikunja routes without contacting a live board.
import assert from "node:assert/strict"
import { test } from "node:test"
import { Vikunja } from "../src/components/vikunja.js"

test("fetches the full task and moves it to the uniquely named board column", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const replies = [Response.json({ id: 42, title: "Task", description: "Full description" }),
    Response.json([{ id: 3, title: "Done" }, { id: 4, title: "Retry" }]), Response.json({})]
  const request: typeof fetch = async (url, init) => { calls.push({ url: String(url), init }); return replies.shift()! }
  const client = new Vikunja({ baseUrl: "https://vikunja.test", token: "token", projectId: 5, viewId: 6 }, request)
  assert.deepEqual(await client.getTask(42), { id: 42, title: "Task", description: "Full description" })
  await client.moveToColumn(42, "Done")
  assert.equal(calls[0].url, "https://vikunja.test/api/v1/tasks/42")
  assert.equal(calls[2].url, "https://vikunja.test/api/v1/projects/5/views/6/buckets/3/tasks")
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), { task_id: 42, bucket_id: 3, project_view_id: 6, project_id: 5 })
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer token")
})

test("rejects ambiguous columns, bad tasks, and failed requests", async () => {
  const replies = [Response.json([{ id: 1, title: "Done" }, { id: 2, title: "Done" }]),
    Response.json({ id: 42, title: "Task" }), new Response(null, { status: 503 })]
  const client = new Vikunja({ baseUrl: "https://vikunja.test", token: "token", projectId: 5, viewId: 6 }, async () => replies.shift()!)
  await assert.rejects(client.moveToColumn(42, "Done"), /exactly one/)
  await assert.rejects(client.getTask(42), /invalid task/)
  await assert.rejects(client.getTask(42), /HTTP 503/)
})
