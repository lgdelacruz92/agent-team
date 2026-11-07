// Checks warning timing and confirms monitoring never changes assignments.
import assert from "node:assert/strict"
import { test } from "node:test"
import { AssignmentMonitor } from "../src/components/assignment-monitor.js"
import { AgentStore } from "../src/db/agent-store.js"
import { AssignmentStore } from "../src/db/assignment-store.js"
import { openDatabase } from "../src/db/database.js"
import { TicketStore } from "../src/db/ticket-store.js"

function setup() {
  const database = openDatabase(":memory:")
  const ticket = new TicketStore(database).create({
    vikunjaTaskId: 42, title: "Test", status: "Ready", priority: 0, presentOnBoard: true,
  })
  const agent = new AgentStore(database).create({ name: "agent", status: "idle" })
  const assignments = new AssignmentStore(database)
  const messages: string[] = []
  const monitor = new AssignmentMonitor(assignments, 60_000, (message) => messages.push(message))
  return { database, ticket, agent, assignments, messages, monitor }
}

test("warns at the threshold and repeats at the interval without changing data", () => {
  const context = setup()
  try {
    const now = Date.parse("2026-11-07T12:00:00.000Z")
    const assignment = context.assignments.create({
      ticketId: context.ticket.id, agentId: context.agent.id, status: "assigned", assignedAt: new Date(now).toISOString(),
    })
    context.monitor.check(now + 59_999)
    assert.deepEqual(context.messages, [])
    context.monitor.check(now + 60_000)
    assert.deepEqual(context.messages, [`assignment ${assignment.id}, ticket ${context.ticket.id}, agent ${context.agent.id}: still assigned after 60 seconds`])
    context.monitor.check(now + 119_999)
    assert.equal(context.messages.length, 1)
    context.monitor.check(now + 120_000)
    assert.equal(context.messages.length, 2)
    assert.match(context.messages[1], /120 seconds/)
    assert.deepEqual(context.assignments.get(assignment.id), assignment)
    assert.equal(new AgentStore(context.database).get(context.agent.id)?.status, "idle")
    assert.equal(new TicketStore(context.database).get(context.ticket.id)?.status, "Ready")
  } finally {
    context.database.close()
  }
})

test("ignores running, completed, and not-yet-old assignments", () => {
  const context = setup()
  try {
    const now = Date.parse("2026-11-07T12:00:00.000Z")
    const old = new Date(now - 120_000).toISOString()
    const base = { ticketId: context.ticket.id, agentId: context.agent.id, assignedAt: old }
    context.assignments.create({ ...base, status: "running" })
    context.assignments.create({ ...base, status: "assigned", completedAt: new Date(now).toISOString() })
    context.assignments.create({ ...base, status: "completed" })
    context.assignments.create({ ...base, status: "assigned", assignedAt: new Date(now - 10_000).toISOString() })
    context.assignments.create({ ...base, status: "assigned", assignedAt: new Date(now + 10_000).toISOString() })
    context.monitor.check(now)
    assert.deepEqual(context.messages, [])
  } finally {
    context.database.close()
  }
})

test("stops warning after progress and warns again if the assignment returns to assigned", () => {
  const context = setup()
  try {
    const now = Date.parse("2026-11-07T12:00:00.000Z")
    const assignment = context.assignments.create({
      ticketId: context.ticket.id, agentId: context.agent.id, status: "assigned",
      assignedAt: new Date(now - 120_000).toISOString(),
    })
    context.monitor.check(now)
    context.assignments.update(assignment.id, { ...assignment, status: "running" })
    context.monitor.check(now + 1)
    assert.equal(context.messages.length, 1)
    context.assignments.update(assignment.id, assignment)
    context.monitor.check(now + 2)
    assert.equal(context.messages.length, 2)
  } finally {
    context.database.close()
  }
})

test("warns about an invalid assignment timestamp without flooding logs", () => {
  const context = setup()
  try {
    const assignment = context.assignments.create({
      ticketId: context.ticket.id, agentId: context.agent.id, status: "assigned", assignedAt: "invalid",
    })
    context.monitor.check(120_000)
    context.monitor.check(120_001)
    assert.equal(context.messages.length, 1)
    assert.match(context.messages[0], new RegExp(`assignment ${assignment.id}.*invalid assigned_at`))
    context.monitor.check(180_000)
    assert.equal(context.messages.length, 2)
  } finally {
    context.database.close()
  }
})
