// Checks atomic assignment creation and rejection of unsafe local claims.
import assert from "node:assert/strict"
import { test } from "node:test"
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
  const ticket = tickets.create({ vikunjaTaskId: 42, title: "Build a form", status: "Retry", priority: 2, presentOnBoard: true })
  const agent = agents.create({ name: "frontend-1", status: "idle" })
  const input = {
    ticketId: ticket.id,
    agentId: agent.id,
    assignmentStatus: "running",
    assignedAt: "2026-11-07T12:00:00.000Z",
  }
  return { database, tickets, agents, assignments, ticket, agent, input, schedulerDatabase: new SchedulerDatabase(database) }
}

test("createAssignment reserves the agent without updating ticket or agent status", async () => {
  const context = setup()
  try {
    context.database.exec(`
      CREATE TRIGGER reject_agent_update BEFORE UPDATE ON agents
      BEGIN SELECT RAISE(ABORT, 'agent status belongs to watcher'); END;
      CREATE TRIGGER reject_ticket_update BEFORE UPDATE ON tickets
      BEGIN SELECT RAISE(ABORT, 'ticket status belongs to board'); END;
    `)
    const saved = await context.schedulerDatabase.createAssignment(context.input)
    assert.deepEqual({ ...saved }, {
      id: saved.id,
      ticketId: context.ticket.id,
      agentId: context.agent.id,
      status: "running",
      assignedAt: context.input.assignedAt,
      completedAt: null,
    })
    assert.deepEqual(context.assignments.get(saved.id), saved)
    assert.deepEqual(context.tickets.get(context.ticket.id), context.ticket)
    assert.deepEqual(context.agents.get(context.agent.id), context.agent)
    assert.deepEqual(await context.schedulerDatabase.getReadyTickets(), [])
  } finally {
    context.database.close()
  }
})

for (const missing of ["ticket", "agent"] as const) {
  test(`createAssignment rejects a missing ${missing} without changing any records`, async () => {
    const context = setup()
    try {
      await assert.rejects(context.schedulerDatabase.createAssignment({
        ...context.input,
        ...(missing === "ticket" ? { ticketId: 999 } : { agentId: 999 }),
      }), /does not exist/)
      assert.deepEqual(context.assignments.list(), [])
      assert.deepEqual(context.tickets.get(context.ticket.id), context.ticket)
      assert.deepEqual(context.agents.get(context.agent.id), context.agent)
      // A failed claim releases the transaction so a valid claim can follow.
      await context.schedulerDatabase.createAssignment(context.input)
    } finally {
      context.database.close()
    }
  })
}

test("createAssignment rejects a ticket that is not Ready or Retry", async () => {
  const context = setup()
  try {
    context.tickets.update(context.ticket.id, { ...context.ticket, status: "Done" })
    await assert.rejects(context.schedulerDatabase.createAssignment(context.input), /is not ready/)
    assert.deepEqual(context.assignments.list(), [])
    assert.equal(context.tickets.get(context.ticket.id)?.status, "Done")
    assert.equal(context.agents.get(context.agent.id)?.status, "idle")
  } finally {
    context.database.close()
  }
})

test("createAssignment rejects a ticket absent from the latest board", async () => {
  const context = setup()
  try {
    context.tickets.update(context.ticket.id, { ...context.ticket, presentOnBoard: false })
    await assert.rejects(context.schedulerDatabase.createAssignment(context.input), /is not ready/)
    assert.deepEqual(context.assignments.list(), [])
    assert.equal(context.tickets.get(context.ticket.id)?.status, "Retry")
    assert.deepEqual(context.agents.get(context.agent.id), context.agent)
  } finally {
    context.database.close()
  }
})

for (const status of ["busy", "offline", "Idle"]) {
  test(`createAssignment rejects an agent with status ${status}`, async () => {
    const context = setup()
    try {
      context.agents.update(context.agent.id, { name: context.agent.name, status })
      await assert.rejects(context.schedulerDatabase.createAssignment(context.input), /is not available/)
      assert.deepEqual(context.assignments.list(), [])
      assert.deepEqual(context.tickets.get(context.ticket.id), context.ticket)
    } finally {
      context.database.close()
    }
  })
}

test("createAssignment rejects duplicate active ownership even after a board refresh resets status", async () => {
  const context = setup()
  try {
    const first = await context.schedulerDatabase.createAssignment(context.input)
    context.tickets.update(context.ticket.id, context.ticket)
    const other = context.agents.create({ name: "frontend-2", status: "idle" })
    await assert.rejects(context.schedulerDatabase.createAssignment({ ...context.input, agentId: other.id }), /active assignment/)
    assert.deepEqual(context.assignments.list(), [first])
    assert.equal(context.agents.get(other.id)?.status, "idle")
  } finally {
    context.database.close()
  }
})

test("createAssignment rejects an idle agent that still has an incomplete assignment", async () => {
  const context = setup()
  try {
    const other = context.tickets.create({ ...context.ticket, vikunjaTaskId: 43 })
    const existing = await context.schedulerDatabase.createAssignment({ ...context.input, ticketId: other.id })
    assert.equal(context.agents.get(context.agent.id)?.status, "idle")
    await assert.rejects(context.schedulerDatabase.createAssignment(context.input), /is not available/)
    assert.deepEqual(context.assignments.list(), [existing])
    assert.deepEqual(context.tickets.get(context.ticket.id), context.ticket)
  } finally {
    context.database.close()
  }
})

test("createAssignment leaves ticket and agent unchanged if inserting the assignment fails", async () => {
  const context = setup()
  try {
    context.database.exec(`
      CREATE TRIGGER reject_insert BEFORE INSERT ON assignments
      BEGIN SELECT RAISE(ABORT, 'forced insert failure'); END;
    `)
    await assert.rejects(context.schedulerDatabase.createAssignment(context.input), /forced insert failure/)
    assert.deepEqual(context.assignments.list(), [])
    assert.deepEqual(context.tickets.get(context.ticket.id), context.ticket)
    assert.deepEqual(context.agents.get(context.agent.id), context.agent)
    context.database.exec("DROP TRIGGER reject_insert")
    await context.schedulerDatabase.createAssignment(context.input)
  } finally {
    context.database.close()
  }
})

test("createAssignment allows a new attempt after the old assignment completes and the agent is idle", async () => {
  const context = setup()
  try {
    const old = context.assignments.create({ ticketId: context.ticket.id, agentId: context.agent.id, status: "running" })
    context.assignments.update(old.id, { ...old, status: "completed", completedAt: "2026-11-07T11:00:00.000Z" })
    const saved = await context.schedulerDatabase.createAssignment(context.input)
    assert.notEqual(saved.id, old.id)
    assert.equal(context.assignments.list().length, 2)
  } finally {
    context.database.close()
  }
})
