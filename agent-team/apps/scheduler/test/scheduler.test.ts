// Tests one scheduling pass with interface doubles, not real integrations.
import assert from "node:assert/strict"
import { test } from "node:test"
import { Scheduler } from "../src/components/scheduler.js"
import type { AgentManagerInterface } from "../src/interfaces/agent-manager.interface.js"
import type { Assignment, SchedulerDatabaseInterface, SchedulerTicket } from "../src/interfaces/scheduler-database.interface.js"
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

  const vikunja: VikunjaInterface = {
    async getTickets() {
      events.push("getTickets")
      return [readyTicket, retryTicket]
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

  const scheduler = new Scheduler(vikunja, database, agentManager)
  return { scheduler, vikunja, database, agentManager, events, savedTickets, assignedTickets }
}

test("runOnce saves every fetched ticket before assigning one", async () => {
  const context = setup()

  assert.equal(await context.scheduler.runOnce(), undefined)
  assert.deepEqual(context.events, [
    "getTickets", "syncTickets", "getReadyTickets", "assignTicket",
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
    assert.equal(context.events.at(-1), `failed:${stage}`)
  })
}
