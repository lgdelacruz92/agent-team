// Tests one agent-check pass with fake database and OpenCode clients.
import assert from "node:assert/strict"
import { test } from "node:test"
import { ResourceManager } from "../src/components/resource-manager.js"
import type { Agent } from "../src/interfaces/resource-manager-database.interface.js"
import type { OpencodeState } from "../src/interfaces/opencode-agent-client.interface.js"

const agent = (id: number, status: string, url: string | null): Agent => ({ id, name: `agent ${id}`, status, url })

test("checks every agent and flags only unreachable agents", async (t) => {
  t.mock.method(console, "log", () => {})
  t.mock.method(console, "warn", () => {})
  const agents = [
    agent(1, "idle", "http://one"),
    agent(2, "idle", "http://two"),
    agent(3, "busy", "http://three"),
    agent(4, "needs_review", "http://four"),
    agent(5, "idle", "http://five"),
    agent(6, "idle", null),
    agent(7, "needs_review", "http://seven"),
  ]
  const states: Record<string, OpencodeState> = {
    "http://one": "unreachable", "http://two": "idle", "http://three": "busy",
    "http://four": "idle", "http://five": "unknown", "http://seven": "unreachable",
  }
  const checked: string[] = []
  const updates: Array<[number, string]> = []
  const manager = new ResourceManager({
    async listAgents() { return agents },
    async updateAgentStatus(id, status) { updates.push([id, status]) },
  }, (url) => ({
    async state() { checked.push(url); return states[url] },
  }))

  await manager.runOnce()

  assert.deepEqual(checked, ["http://one", "http://two", "http://three", "http://four", "http://five", "http://seven"])
  assert.deepEqual(updates, [[1, "needs_review"]])
})

test("continues checking after a client or database update fails", async (t) => {
  t.mock.method(console, "log", () => {})
  t.mock.method(console, "error", () => {})
  const checked: string[] = []
  const updates: number[] = []
  const manager = new ResourceManager({
    async listAgents() { return [agent(1, "idle", "one"), agent(2, "idle", "two"), agent(3, "idle", "three")] },
    async updateAgentStatus(id) {
      updates.push(id)
      if (id === 2) throw new Error("database error")
    },
  }, (url) => ({
    async state() {
      checked.push(url)
      if (url === "one") throw new Error("client error")
      return "unreachable"
    },
  }))

  await assert.rejects(manager.runOnce(), AggregateError)
  assert.deepEqual(checked, ["one", "two", "three"])
  assert.deepEqual(updates, [2, 3])
})

test("propagates a failure to list agents", async () => {
  const manager = new ResourceManager({
    async listAgents() { throw new Error("database unavailable") },
    async updateAgentStatus() { throw new Error("unexpected update") },
  }, () => { throw new Error("unexpected client") })

  await assert.rejects(manager.runOnce(), /database unavailable/)
})
