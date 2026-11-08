// Tests the agent database adapter with an isolated in-memory database.
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { AgentDatabase } from "../src/components/agent-database.js"
import { openDatabase } from "../src/db/database.js"

test("reads agents and writes the review flag without changing other fields", async () => {
  const database = new DatabaseSync(":memory:")
  try {
    database.exec("CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT, status TEXT, url TEXT)")
    database.prepare("INSERT INTO agents VALUES (?, ?, ?, ?)").run(1, "frontend", "idle", "http://frontend")
    const agents = new AgentDatabase(database)

    assert.deepEqual(await agents.listAgents(), [{ id: 1, name: "frontend", status: "idle", url: "http://frontend" }])
    await agents.updateAgentStatus(1, "needs_review")
    assert.deepEqual(await agents.listAgents(), [{ id: 1, name: "frontend", status: "needs_review", url: "http://frontend" }])
    await assert.rejects(agents.updateAgentStatus(99, "needs_review"), /not found/)
  } finally {
    database.close()
  }
})

test("rejects invalid agent data rather than guessing", async () => {
  const database = new DatabaseSync(":memory:")
  try {
    database.exec("CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT, status TEXT, url TEXT)")
    database.exec("INSERT INTO agents VALUES (1, NULL, 'idle', 'http://agent')")
    await assert.rejects(new AgentDatabase(database).listAgents(), /Invalid agent row/)
  } finally {
    database.close()
  }
})

test("requires an existing database and agent URL column", () => {
  assert.throws(() => openDatabase("/this-resource-manager-database-does-not-exist"), /does not exist/)
  assert.throws(() => openDatabase(":memory:"), /agents table with id, name, status, and url/)
})
