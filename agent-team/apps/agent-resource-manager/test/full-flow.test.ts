// Full manager adapters against an isolated database and fake HTTP services.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { AssignmentReconciler } from "../src/components/assignment-reconciler.js"
import { OpencodeAgentClient } from "../src/components/opencode-agent-client.js"
import { ResourceManagerDatabase } from "../src/components/resource-manager-database.js"
import { SharedLock } from "../src/components/shared-lock.js"
import { Vikunja } from "../src/components/vikunja.js"

test("real adapters dispatch and complete through controlled HTTP endpoints", async (t) => {
  const db = new DatabaseSync(":memory:")
  t.after(() => db.close())
  db.exec(readFileSync(new URL("../../shared-db/seed.sql", import.meta.url), "utf8"))
  db.exec("INSERT INTO tickets VALUES (1, 42, 'Task', 'Ready', 1, 1); INSERT INTO agents VALUES (1, 'worker', 'idle', 'http://agent'); INSERT INTO assignments VALUES (1, 1, 1, 'assigned', '2026-01-01', NULL)")
  let busy = false
  const moves: number[] = []
  const requests: string[] = []
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? "GET"
    requests.push(`${method} ${url.host}${url.pathname}`)
    if (url.host === "board") {
      if (url.pathname === "/api/v1/tasks/42") return Response.json({ id: 42, title: "Task", description: "Do the work" })
      if (url.pathname.endsWith("/tasks") && method === "GET") return Response.json([{ id: 1, title: "In progress" }, { id: 2, title: "Done" }, { id: 3, title: "Retry" }])
      if (url.pathname.includes("/buckets/") && method === "POST") {
        moves.push(JSON.parse(String(init?.body)).bucket_id)
        return Response.json({})
      }
    }
    if (url.host === "agent") {
      if (url.pathname === "/api/session/active" && method === "GET") return Response.json({ data: busy ? { ses_1: { type: "running" } } : {} })
      if (url.pathname === "/api/session" && method === "POST") return Response.json({ data: { id: "ses_1" } })
      if (url.pathname === "/api/session/ses_1/prompt") return Response.json({})
      if (url.pathname === "/api/session/ses_1") return Response.json({ data: { id: "ses_1", time: busy ? { busy: 2 } : { busy: 2, idle: 3 } } })
    }
    throw new Error(`Unexpected request ${method} ${url}`)
  })
  const database = new ResourceManagerDatabase(db)
  const manager = new AssignmentReconciler(database, new Vikunja({ baseUrl: "http://board", token: "secret", projectId: 1, viewId: 1 }), new SharedLock(db), (url) => new OpencodeAgentClient(url))
  await manager.runOnce()
  busy = true
  await manager.runOnce()
  busy = false
  await manager.runOnce()
  await manager.runOnce()
  assert.deepEqual(moves, [1, 2])
  assert.ok((await database.getAssignment(1))?.completedAt)
  assert.ok(requests.includes("POST agent/api/session/ses_1/prompt"))
})
