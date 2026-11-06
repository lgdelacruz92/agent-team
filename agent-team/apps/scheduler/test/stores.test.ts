// Exercises each table store, database constraints, and persistence across restarts.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { AgentStore } from "../src/db/agent-store.js"
import { AssignmentStore } from "../src/db/assignment-store.js"
import { openDatabase } from "../src/db/database.js"
import { TicketStore } from "../src/db/ticket-store.js"

const ticketInput = { vikunjaTaskId: 42, title: "Build a form", status: "Ready", priority: 2 }
const agentInput = { name: "frontend-1", status: "idle" }

test("TicketStore creates, looks up, lists, updates and deletes tickets", () => {
  const database = openDatabase(":memory:")

  try {
    const store = new TicketStore(database)
    const ticket = store.create(ticketInput)
    assert.deepEqual({ ...ticket }, { id: ticket.id, ...ticketInput })
    assert.deepEqual(store.get(ticket.id), ticket)
    assert.deepEqual(store.getByVikunjaTaskId(42), ticket)
    assert.deepEqual(store.list(), [ticket])
    assert.equal(store.get(999), undefined)
    assert.equal(store.getByVikunjaTaskId(999), undefined)
    assert.throws(() => store.create(ticketInput), /UNIQUE constraint failed/)

    const changed = { ...ticketInput, vikunjaTaskId: 43, title: "Updated", status: "Review", priority: 3 }
    assert.deepEqual({ ...store.update(ticket.id, changed) }, { id: ticket.id, ...changed })
    assert.equal(store.getByVikunjaTaskId(42), undefined)
    assert.equal(store.update(999, changed), undefined)
    assert.equal(store.delete(ticket.id), true)
    assert.equal(store.delete(ticket.id), false)
    assert.deepEqual(store.list(), [])
  } finally {
    database.close()
  }
})

test("AgentStore creates, looks up, lists, updates and deletes agents", () => {
  const database = openDatabase(":memory:")

  try {
    const store = new AgentStore(database)
    const agent = store.create(agentInput)
    assert.deepEqual({ ...agent }, { id: agent.id, ...agentInput })
    assert.deepEqual(store.get(agent.id), agent)
    assert.deepEqual(store.list(), [agent])
    assert.equal(store.get(999), undefined)

    const changed = { name: "frontend-renamed", status: "busy" }
    assert.deepEqual({ ...store.update(agent.id, changed) }, { id: agent.id, ...changed })
    assert.equal(store.update(999, changed), undefined)
    assert.equal(store.delete(agent.id), true)
    assert.equal(store.delete(agent.id), false)
    assert.deepEqual(store.list(), [])
  } finally {
    database.close()
  }
})

test("AssignmentStore supports history, filtering, completion and deletion", () => {
  const database = openDatabase(":memory:")

  try {
    const tickets = new TicketStore(database)
    const agents = new AgentStore(database)
    const store = new AssignmentStore(database)
    const ticket = tickets.create(ticketInput)
    const otherTicket = tickets.create({ ...ticketInput, vikunjaTaskId: 43 })
    const agent = agents.create(agentInput)
    const otherAgent = agents.create({ ...agentInput, name: "frontend-2" })
    const input = { ticketId: ticket.id, agentId: agent.id, status: "running" }
    const assignment = store.create(input)
    assert.deepEqual({ ...assignment }, {
      id: assignment.id,
      ...input,
      assignedAt: assignment.assignedAt,
      completedAt: null,
    })
    assert.equal(new Date(assignment.assignedAt).toISOString(), assignment.assignedAt)
    const retry = store.create({ ...input, assignedAt: "2026-11-06T12:00:00.000Z" })
    const unrelated = store.create({ ticketId: otherTicket.id, agentId: otherAgent.id, status: "running" })
    assert.deepEqual(store.get(assignment.id), assignment)
    assert.equal(store.get(999), undefined)
    assert.deepEqual(store.list(), [assignment, retry, unrelated])
    assert.deepEqual(store.listByTicketId(ticket.id), [assignment, retry])
    assert.deepEqual(store.listByAgentId(agent.id), [assignment, retry])
    assert.deepEqual(store.listByAgentId(999), [])

    const completed = { ...assignment, status: "completed", completedAt: "2026-11-06T13:00:00.000Z" }
    assert.deepEqual({ ...store.update(assignment.id, completed) }, completed)
    assert.equal(store.update(999, completed), undefined)
    assert.equal(store.update(assignment.id, { ...completed, completedAt: null })?.completedAt, null)
    assert.equal(store.delete(assignment.id), true)
    assert.equal(store.delete(assignment.id), false)
  } finally {
    database.close()
  }
})

test("assignments enforce both foreign keys and protect referenced records", () => {
  const database = openDatabase(":memory:")

  try {
    const tickets = new TicketStore(database)
    const agents = new AgentStore(database)
    const assignments = new AssignmentStore(database)
    const ticket = tickets.create(ticketInput)
    const agent = agents.create(agentInput)
    const input = { ticketId: ticket.id, agentId: agent.id, status: "running" }
    assert.throws(() => assignments.create({ ...input, ticketId: 999 }), /FOREIGN KEY constraint failed/)
    assert.throws(() => assignments.create({ ...input, agentId: 999 }), /FOREIGN KEY constraint failed/)
    const assignment = assignments.create(input)
    assert.throws(() => assignments.update(assignment.id, { ...assignment, agentId: 999 }), /FOREIGN KEY constraint failed/)
    assert.throws(() => tickets.delete(ticket.id), /FOREIGN KEY constraint failed/)
    assert.throws(() => agents.delete(agent.id), /FOREIGN KEY constraint failed/)
    assignments.delete(assignment.id)
    assert.equal(tickets.delete(ticket.id), true)
    assert.equal(agents.delete(agent.id), true)
  } finally {
    database.close()
  }
})

test("all three tables retain data after closing and reopening SQLite", () => {
  const directory = mkdtempSync(join(tmpdir(), "scheduler-stores-test-"))
  const path = join(directory, "nested", "scheduler.sqlite")

  try {
    const first = openDatabase(path)
    let ticketId: number
    let agentId: number
    let assignmentId: number

    try {
      ticketId = new TicketStore(first).create(ticketInput).id
      agentId = new AgentStore(first).create(agentInput).id
      assignmentId = new AssignmentStore(first).create({ ticketId, agentId, status: "running" }).id
    } finally {
      first.close()
    }

    const reopened = openDatabase(path)
    try {
      assert.equal(new TicketStore(reopened).get(ticketId)?.vikunjaTaskId, 42)
      assert.equal(new AgentStore(reopened).get(agentId)?.name, "frontend-1")
      assert.equal(new AssignmentStore(reopened).get(assignmentId)?.ticketId, ticketId)
      assert.throws(() => new AssignmentStore(reopened).create({ ticketId: 999, agentId, status: "running" }), /FOREIGN KEY constraint failed/)
    } finally {
      reopened.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
