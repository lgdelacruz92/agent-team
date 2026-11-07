// Checks local agent selection, reservation, and reuse after a failed board move.
import assert from "node:assert/strict"
import { test } from "node:test"
import { AgentManager } from "../src/components/agent-manager.js"
import { SchedulerDatabase } from "../src/components/scheduler-database.js"
import { AgentStore } from "../src/db/agent-store.js"
import { AssignmentStore } from "../src/db/assignment-store.js"
import { openDatabase } from "../src/db/database.js"
import { TicketStore } from "../src/db/ticket-store.js"

function setup() {
  const database = openDatabase(":memory:")
  const tickets = new TicketStore(database)
  const agents = new AgentStore(database)
  const assignments = new AssignmentStore(database)
  const schedulerDatabase = new SchedulerDatabase(database)
  const manager = new AgentManager(schedulerDatabase, agents, assignments)
  const ticket = tickets.create({ vikunjaTaskId: 42, title: "Build a form", status: "Ready", priority: 1 })
  return { database, tickets, agents, assignments, schedulerDatabase, manager, ticket }
}

test("assignTicket chooses the first idle agent, skipping offline, busy, and reserved agents", async () => {
  const context = setup()
  try {
    context.agents.create({ name: "offline", status: "offline" })
    context.agents.create({ name: "busy", status: "busy" })
    const reserved = context.agents.create({ name: "reserved", status: "idle" })
    const otherTicket = context.tickets.create({ ...context.ticket, vikunjaTaskId: 43 })
    context.assignments.create({ ticketId: otherTicket.id, agentId: reserved.id, status: "running" })
    const firstFree = context.agents.create({ name: "free-1", status: "idle" })
    const secondFree = context.agents.create({ name: "free-2", status: "idle" })

    const before = Date.now()
    const saved = await context.manager.assignTicket(context.ticket)

    assert.ok(saved)
    assert.equal(saved.ticketId, context.ticket.id)
    assert.equal(saved.agentId, firstFree.id)
    assert.equal(saved.status, "assigned")
    assert.equal(saved.completedAt, null)
    assert.ok(Date.parse(saved.assignedAt) >= before && Date.parse(saved.assignedAt) <= Date.now())
    assert.equal(context.tickets.get(context.ticket.id)?.status, "In progress")
    assert.equal(context.agents.get(firstFree.id)?.status, "idle")
    assert.equal(context.agents.get(secondFree.id)?.status, "idle")
  } finally {
    context.database.close()
  }
})

test("assignTicket returns null without changing state when no agent is available", async () => {
  const context = setup()
  try {
    assert.equal(await context.manager.assignTicket(context.ticket), null)
    context.agents.create({ name: "busy", status: "busy" })
    assert.equal(await context.manager.assignTicket(context.ticket), null)
    assert.deepEqual(context.assignments.list(), [])
    assert.deepEqual(context.tickets.get(context.ticket.id), context.ticket)
  } finally {
    context.database.close()
  }
})

test("assignTicket accepts Retry and does not reserve one agent for two tickets", async () => {
  const context = setup()
  try {
    const agent = context.agents.create({ name: "frontend", status: "idle" })
    const retry = context.tickets.create({ ...context.ticket, vikunjaTaskId: 43, status: "Retry" })
    assert.ok(await context.manager.assignTicket(retry))
    assert.equal(context.agents.get(agent.id)?.status, "idle")
    assert.equal(await context.manager.assignTicket(context.ticket), null)
    assert.equal(context.assignments.list().length, 1)
  } finally {
    context.database.close()
  }
})

test("assignTicket reuses active ownership after a board refresh, even with a new manager", async () => {
  const context = setup()
  try {
    context.agents.create({ name: "frontend", status: "idle" })
    const first = await context.manager.assignTicket(context.ticket)
    const refreshed = await context.schedulerDatabase.saveTicket(context.ticket)
    const restartedManager = new AgentManager(context.schedulerDatabase, context.agents, context.assignments)
    assert.deepEqual(await restartedManager.assignTicket(refreshed), first)
    assert.equal(context.assignments.list().length, 1)
  } finally {
    context.database.close()
  }
})

test("assignTicket preserves an existing running assignment", async () => {
  const context = setup()
  try {
    const agent = context.agents.create({ name: "frontend", status: "idle" })
    const existing = context.assignments.create({ ticketId: context.ticket.id, agentId: agent.id, status: "running" })
    assert.deepEqual(await context.manager.assignTicket(context.ticket), existing)
    assert.equal(context.assignments.list().length, 1)
  } finally {
    context.database.close()
  }
})

test("assignTicket permits completed history but requires the agent to be idle again", async () => {
  const context = setup()
  try {
    const agent = context.agents.create({ name: "frontend", status: "idle" })
    const old = context.assignments.create({ ticketId: context.ticket.id, agentId: agent.id, status: "completed" })
    context.assignments.update(old.id, { ...old, completedAt: "2026-11-07T11:00:00.000Z" })
    context.agents.update(agent.id, { name: agent.name, status: "busy" })
    assert.equal(await context.manager.assignTicket(context.ticket), null)
    context.agents.update(agent.id, { name: agent.name, status: "idle" })
    const saved = await context.manager.assignTicket(context.ticket)
    assert.ok(saved)
    assert.notEqual(saved.id, old.id)
    assert.equal(saved.agentId, agent.id)
  } finally {
    context.database.close()
  }
})

test("assignTicket rejects non-ready tickets and propagates persistence failures", async () => {
  const context = setup()
  try {
    await assert.rejects(context.manager.assignTicket({ ...context.ticket, status: "Done" }), /is not ready/)
    context.agents.create({ name: "frontend", status: "idle" })
    const error = new Error("Assignment write failed")
    const manager = new AgentManager({
      saveTicket: (ticket) => context.schedulerDatabase.saveTicket(ticket),
      getReadyTickets: () => context.schedulerDatabase.getReadyTickets(),
      async createAssignment() { throw error },
    }, context.agents, context.assignments)
    await assert.rejects(manager.assignTicket(context.ticket), (actual) => actual === error)
    assert.deepEqual(context.assignments.list(), [])
    assert.equal(context.agents.list()[0].status, "idle")
  } finally {
    context.database.close()
  }
})

test("concurrent calls for the same ticket return one saved assignment", async () => {
  const context = setup()
  try {
    context.agents.create({ name: "frontend", status: "idle" })
    const results = await Promise.all([
      context.manager.assignTicket(context.ticket),
      context.manager.assignTicket(context.ticket),
    ])
    assert.ok(results[0])
    assert.deepEqual(results[0], results[1])
    assert.equal(context.assignments.list().length, 1)
  } finally {
    context.database.close()
  }
})
