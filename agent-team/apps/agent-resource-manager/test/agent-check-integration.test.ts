// Exercises the agent-check slice with an isolated database and fake HTTP responses.
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { AgentDatabase } from "../src/components/agent-database.js"
import { OpencodeAgentClient } from "../src/components/opencode-agent-client.js"
import { ResourceManager } from "../src/components/resource-manager.js"

test("checks registered agents and persists only the unreachable review flag", async (t) => {
  t.mock.method(console, "log", () => {})
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    if (String(input).startsWith("http://offline/")) {
      throw new Error("connection refused")
    }
    return Response.json({ data: [], cursor: { next: null } })
  })
  const database = new DatabaseSync(":memory:")
  try {
    database.exec("CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT, status TEXT, url TEXT)")
    database.exec("INSERT INTO agents VALUES (1, 'online', 'idle', 'http://online'), (2, 'offline', 'idle', 'http://offline')")
    const agents = new AgentDatabase(database)
    const manager = new ResourceManager(agents, (url) => new OpencodeAgentClient(url))

    await manager.runOnce()

    assert.deepEqual((await agents.listAgents()).map(({ status }) => status), ["idle", "needs_review"])
  } finally {
    database.close()
  }
})
