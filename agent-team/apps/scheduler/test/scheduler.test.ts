// Tests one scheduling pass with interface doubles, not real integrations.
import assert from "node:assert/strict"
import { test } from "node:test"
import { Scheduler } from "../src/components/scheduler.js"
import type { AgentManagerInterface } from "../src/interfaces/agent-manager.interface.js"
import type { Assignment, SchedulerDatabaseInterface, SchedulerTicket } from "../src/interfaces/scheduler-database.interface.js"
import type { SharedLockInterface } from "../src/interfaces/shared-lock.interface.js"
import type { VikunjaInterface, VikunjaTicket } from "../src/interfaces/vikunja.interface.js"

const readyTicket: SchedulerTicket = {
  id: 1,
  vikunjaTaskId: 42,
  title: "Build a form",
  status: "Ready",
  priority: 1,
  presentOnBoard: true,
}
const retryTicket: SchedulerTicket = { ...readyTicket, id: 2, vikunjaTaskId: 43, status: "Retry", priority: 5 }
const assignment: Assignment = {
  id: 10,
  ticketId: readyTicket.id,
  agentId: 3,
  status: "assigned",
  assignedAt: "2026-11-06T12:00:00.000Z",
  completedAt: null,
}

function setup() {
  const events: string[] = []
  const savedTickets: VikunjaTicket[] = []
  const assignedTickets: SchedulerTicket[] = []
  const flaggedTaskIds: number[] = []

  const vikunja: VikunjaInterface = {
    async getTickets() {
      events.push("getTickets")
      return [readyTicket, retryTicket]
    },
    async moveToFlagged(taskId) {
      events.push(`moveToFlagged:${taskId}`)
      flaggedTaskIds.push(taskId)
    },
  }
  const database: SchedulerDatabaseInterface = {
    async syncTickets(tickets) {
      events.push("syncTickets")
      savedTickets.push(...tickets)
    },
    async getReadyTickets() {
      events.push("getReadyTickets")
      return [readyTicket, retryTicket]
    },
    async countAttempts(ticketId) {
      events.push(`countAttempts:${ticketId}`)
      return 0
    },
    async createAssignment() {
      assert.fail("Scheduler must leave assignment persistence to the agent manager")
    },
  }
  const agentManager: AgentManagerInterface = {
    async assignTicket(ticket) {
      events.push("assignTicket")
      assignedTickets.push(ticket)
      return { ...assignment, ticketId: ticket.id }
    },
  }

  const lock: SharedLockInterface = {
    async tryAcquire() { events.push("acquire"); return "owner" },
    async release(owner) { assert.equal(owner, "owner"); events.push("release") },
  }
  const scheduler = new Scheduler(vikunja, database, agentManager, lock, 3)
  return { scheduler, vikunja, database, agentManager, lock, events, savedTickets, assignedTickets, flaggedTaskIds }
}

test("runOnce saves every fetched ticket before assigning one", async () => {
  const context = setup()

  assert.equal(await context.scheduler.runOnce(), undefined)
  assert.deepEqual(context.events, [
    "acquire", "getTickets", "syncTickets", "getReadyTickets", "assignTicket", "release",
  ])
  assert.deepEqual(context.savedTickets, [readyTicket, retryTicket])
  assert.deepEqual(context.assignedTickets, [readyTicket])
})

test("runOnce returns without assignment when the database has no ready tickets", async () => {
  const context = setup()
  context.database.getReadyTickets = async () => []

  await context.scheduler.runOnce()
  assert.equal(context.savedTickets.length, 2)
  assert.deepEqual(context.assignedTickets, [])
})

test("runOnce returns when no agent is available without attempting another ticket", async () => {
  const context = setup()
  context.agentManager.assignTicket = async (ticket) => {
    context.assignedTickets.push(ticket)
    return null
  }

  await context.scheduler.runOnce()
  assert.deepEqual(context.assignedTickets, [readyTicket])
})

test("runOnce trusts database ordering and accepts Retry as conceptually ready", async () => {
  const context = setup()
  context.database.getReadyTickets = async () => [retryTicket, readyTicket]

  await context.scheduler.runOnce()
  assert.deepEqual(context.assignedTickets, [retryTicket])
  assert.ok(context.events.includes("countAttempts:2"))
  assert.equal(retryTicket.status, "Retry")
})

test("runOnce synchronizes an empty board and does not assign absent tickets", async () => {
  const context = setup()
  context.vikunja.getTickets = async () => []
  context.database.getReadyTickets = async () => []

  await context.scheduler.runOnce()
  assert.deepEqual(context.savedTickets, [])
  assert.deepEqual(context.assignedTickets, [])
  assert.ok(context.events.includes("syncTickets"))
})

for (const stage of ["getTickets", "syncTickets", "getReadyTickets", "assignTicket"] as const) {
  test(`runOnce propagates ${stage} errors and stops the pass`, async () => {
    const context = setup()
    const error = new Error(`${stage} failed`)
    const fail = async () => {
      context.events.push(`failed:${stage}`)
      throw error
    }

    switch (stage) {
      case "getTickets": context.vikunja.getTickets = fail; break
      case "syncTickets": context.database.syncTickets = fail; break
      case "getReadyTickets": context.database.getReadyTickets = fail; break
      case "assignTicket": context.agentManager.assignTicket = fail; break
    }

    await assert.rejects(context.scheduler.runOnce(), (actual) => actual === error)
    assert.deepEqual(context.events.slice(-2), [`failed:${stage}`, "release"])
  })
}

test("a held lock skips the entire pass", async () => {
  const context = setup()
  context.lock.tryAcquire = async () => { context.events.push("held"); return null }
  await context.scheduler.runOnce()
  assert.deepEqual(context.events, ["held"])
})

test("an exhausted Retry ticket is flagged using its Vikunja ID and is not assigned", async () => {
  const context = setup()
  context.database.getReadyTickets = async () => [retryTicket]
  context.database.countAttempts = async () => 3
  await context.scheduler.runOnce()
  assert.deepEqual(context.assignedTickets, [])
  assert.deepEqual(context.flaggedTaskIds, [retryTicket.vikunjaTaskId])
  assert.deepEqual(context.events.slice(-2), [`moveToFlagged:${retryTicket.vikunjaTaskId}`, "release"])
})

test("a Retry ticket below the limit is assigned", async () => {
  const context = setup()
  context.database.getReadyTickets = async () => [retryTicket]
  context.database.countAttempts = async () => 2
  await context.scheduler.runOnce()
  assert.deepEqual(context.assignedTickets, [retryTicket])
})

test("a Retry ticket above the limit is not assigned", async () => {
  const context = setup()
  context.database.getReadyTickets = async () => [retryTicket]
  context.database.countAttempts = async () => 4
  await context.scheduler.runOnce()
  assert.deepEqual(context.assignedTickets, [])
  assert.deepEqual(context.flaggedTaskIds, [retryTicket.vikunjaTaskId])
})

test("a failed flag move stops the pass without assigning and releases the lock", async () => {
  const context = setup()
  context.database.getReadyTickets = async () => [retryTicket]
  context.database.countAttempts = async () => 3
  context.vikunja.moveToFlagged = async () => { throw new Error("move failed") }
  await assert.rejects(context.scheduler.runOnce(), /move failed/)
  assert.deepEqual(context.assignedTickets, [])
  assert.equal(context.events.at(-1), "release")
})

test("a failed attempt count stops the pass and releases the lock", async () => {
  const context = setup()
  context.database.getReadyTickets = async () => [retryTicket]
  context.database.countAttempts = async () => { throw new Error("count unavailable") }
  await assert.rejects(context.scheduler.runOnce(), /count unavailable/)
  assert.deepEqual(context.assignedTickets, [])
  assert.equal(context.events.at(-1), "release")
})

test("both pass and release errors remain visible", async () => {
  const context = setup()
  context.vikunja.getTickets = async () => { throw new Error("board unavailable") }
  context.lock.release = async () => { throw new Error("release failed") }
  await assert.rejects(context.scheduler.runOnce(), (error: unknown) => {
    assert.ok(error instanceof AggregateError)
    assert.match(String(error.errors[0]), /board unavailable/)
    assert.match(String(error.errors[1]), /release failed/)
    return true
  })
})
