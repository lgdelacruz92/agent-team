// Checks atomic board synchronization and ready-ticket eligibility.
import assert from "node:assert/strict"
import { test } from "node:test"
import { AgentManager } from "../src/components/agent-manager.js"
import { Scheduler } from "../src/components/scheduler.js"
import { SchedulerDatabase } from "../src/components/scheduler-database.js"
import { SharedLock } from "../src/components/shared-lock.js"
import { AgentStore } from "../src/db/agent-store.js"
import { AssignmentStore } from "../src/db/assignment-store.js"
import { createTestDatabase } from "./fixtures/database.js"
import { TicketStore } from "../src/db/ticket-store.js"

const first = { vikunjaTaskId: 42, title: "Build a form", status: "Ready", priority: 3 }
const second = { vikunjaTaskId: 43, title: "Other", status: "Retry", priority: 1 }

test("syncTickets updates presence atomically, preserves IDs, and restores returning tickets", async () => {
  const database = createTestDatabase()
  try {
    const tickets = new TicketStore(database)
    const scheduler = new SchedulerDatabase(database)
    await scheduler.syncTickets([first, second])
    const savedFirst = tickets.getByVikunjaTaskId(first.vikunjaTaskId)!
    const savedSecond = tickets.getByVikunjaTaskId(second.vikunjaTaskId)!
    assert.deepEqual(savedFirst, { id: savedFirst.id, ...first, presentOnBoard: true })
    assert.deepEqual(await scheduler.getReadyTickets(), [savedFirst, savedSecond])

    await scheduler.syncTickets([{ ...second, title: "Updated" }])
    assert.deepEqual(tickets.get(savedFirst.id), { ...savedFirst, presentOnBoard: false })
    assert.deepEqual(await scheduler.getReadyTickets(), [{ ...savedSecond, title: "Updated" }])

    await scheduler.syncTickets([first, second])
    assert.deepEqual(tickets.get(savedFirst.id), savedFirst)
    assert.deepEqual(await scheduler.getReadyTickets(), [savedFirst, savedSecond])
    assert.equal(tickets.list().length, 2)
  } finally {
    database.close()
  }
})

test("an empty successful board marks all tickets absent without deleting assignments", async () => {
  const database = createTestDatabase()
  try {
    const scheduler = new SchedulerDatabase(database)
    const tickets = new TicketStore(database)
    const agent = new AgentStore(database).create({ name: "agent", status: "idle" })
    const assignments = new AssignmentStore(database)
    await scheduler.syncTickets([first])
    const ticket = tickets.getByVikunjaTaskId(first.vikunjaTaskId)!
    const assignment = assignments.create({ ticketId: ticket.id, agentId: agent.id, status: "assigned" })

    await scheduler.syncTickets([])
    assert.deepEqual(tickets.get(ticket.id), { ...ticket, presentOnBoard: false })
    assert.deepEqual(assignments.get(assignment.id), assignment)
    assert.deepEqual(await scheduler.getReadyTickets(), [])
    await assert.rejects(scheduler.createAssignment({
      ticketId: ticket.id, agentId: agent.id, assignmentStatus: "assigned",
      assignedAt: new Date().toISOString(),
    }), /not ready/)
  } finally {
    database.close()
  }
})

test("a failed sync rolls back presence and ticket changes", async () => {
  const database = createTestDatabase()
  try {
    const scheduler = new SchedulerDatabase(database)
    const tickets = new TicketStore(database)
    await scheduler.syncTickets([first, second])
    const before = tickets.list()
    database.exec(`
      CREATE TRIGGER reject_board_insert BEFORE INSERT ON tickets
      BEGIN SELECT RAISE(ABORT, 'forced sync failure'); END;
    `)
    await assert.rejects(scheduler.syncTickets([
      { ...first, title: "Changed" },
      { ...second, vikunjaTaskId: 44 },
    ]), /forced sync failure/)
    assert.deepEqual(tickets.list(), before)
    assert.deepEqual(await scheduler.getReadyTickets(), before)
  } finally {
    database.close()
  }
})

test("a failed board fetch leaves presence unchanged and skips assignment", async () => {
  const database = createTestDatabase()
  try {
    const schedulerDatabase = new SchedulerDatabase(database)
    const tickets = new TicketStore(database)
    const agents = new AgentStore(database)
    const assignments = new AssignmentStore(database)
    agents.create({ name: "agent", status: "idle" })
    await schedulerDatabase.syncTickets([first])
    const before = tickets.list()
    const scheduler = new Scheduler({
      async getTickets() { throw new Error("board unavailable") },
      async moveToFlagged() { assert.fail("no move expected") },
    }, schedulerDatabase, new AgentManager(schedulerDatabase, agents, assignments), new SharedLock(database), 3)

    await assert.rejects(scheduler.runOnce(), /board unavailable/)
    assert.deepEqual(tickets.list(), before)
    assert.deepEqual(assignments.list(), [])
  } finally {
    database.close()
  }
})

test("a successful fetch missing a previously ready ticket cannot assign it", async () => {
  const database = createTestDatabase()
  try {
    const schedulerDatabase = new SchedulerDatabase(database)
    const tickets = new TicketStore(database)
    const agents = new AgentStore(database)
    const assignments = new AssignmentStore(database)
    agents.create({ name: "agent", status: "idle" })
    await schedulerDatabase.syncTickets([first])
    const scheduler = new Scheduler({
      async getTickets() { return [] },
      async moveToFlagged() { assert.fail("no move expected") },
    }, schedulerDatabase, new AgentManager(schedulerDatabase, agents, assignments), new SharedLock(database), 3)
    await scheduler.runOnce()
    assert.equal(tickets.getByVikunjaTaskId(first.vikunjaTaskId)?.presentOnBoard, false)
    assert.deepEqual(assignments.list(), [])
  } finally {
    database.close()
  }
})

test("getReadyTickets selects only present Ready and Retry tickets in local ID order", async () => {
  const database = createTestDatabase()
  try {
    const scheduler = new SchedulerDatabase(database)
    await scheduler.syncTickets([
      first,
      { ...second, status: "Review" },
      { ...second, vikunjaTaskId: 44 },
      { ...second, vikunjaTaskId: 45, status: "ready" },
    ])
    const ready = await scheduler.getReadyTickets()
    assert.deepEqual(ready.map((ticket) => ticket.vikunjaTaskId), [42, 44])
    assert.deepEqual(ready.map((ticket) => ticket.status), ["Ready", "Retry"])
  } finally {
    database.close()
  }
})

test("getReadyTickets skips incomplete assignments and allows completed history", async () => {
  const database = createTestDatabase()
  try {
    const scheduler = new SchedulerDatabase(database)
    const tickets = new TicketStore(database)
    const agents = new AgentStore(database)
    const assignments = new AssignmentStore(database)
    await scheduler.syncTickets([first, second])
    const firstTicket = tickets.getByVikunjaTaskId(first.vikunjaTaskId)!
    const secondTicket = tickets.getByVikunjaTaskId(second.vikunjaTaskId)!
    const agent = agents.create({ name: "agent", status: "idle" })
    const active = assignments.create({ ticketId: firstTicket.id, agentId: agent.id, status: "assigned" })
    const completed = assignments.create({ ticketId: secondTicket.id, agentId: agent.id, status: "completed", completedAt: "2026-11-07T12:00:00.000Z" })

    assert.deepEqual(await scheduler.getReadyTickets(), [secondTicket])
    assignments.update(active.id, { ...active, status: "completed", completedAt: "2026-11-07T12:01:00.000Z" })
    assert.deepEqual(await scheduler.getReadyTickets(), [firstTicket, secondTicket])
    assignments.update(completed.id, { ...completed, completedAt: null })
    assert.deepEqual(await scheduler.getReadyTickets(), [firstTicket])
  } finally {
    database.close()
  }
})

test("countAttempts counts recorded requests across the ticket's assignments only", async () => {
  const database = createTestDatabase()
  try {
    const scheduler = new SchedulerDatabase(database)
    const tickets = new TicketStore(database)
    const agent = new AgentStore(database).create({ name: "agent", status: "idle" })
    const assignments = new AssignmentStore(database)
    const ticket = tickets.create({ ...first, presentOnBoard: true })
    const other = tickets.create({ ...second, presentOnBoard: true })
    const one = assignments.create({ ticketId: ticket.id, agentId: agent.id, status: "failed" })
    const two = assignments.create({ ticketId: ticket.id, agentId: agent.id, status: "assigned" })
    const otherAssignment = assignments.create({ ticketId: other.id, agentId: agent.id, status: "failed" })
    const insert = database.prepare(`
      INSERT INTO executions (assignment_id, status, created_at, work_requested_at)
      VALUES (?, 'failed', '2026-01-01', ?)
    `)
    insert.run(one.id, "2026-01-01")
    insert.run(one.id, null)
    insert.run(two.id, "2026-01-02")
    insert.run(otherAssignment.id, "2026-01-03")
    assert.equal(await scheduler.countAttempts(ticket.id), 2)
    assert.equal(await scheduler.countAttempts(other.id), 1)
    assert.equal(await scheduler.countAttempts(999), 0)
  } finally {
    database.close()
  }
})
