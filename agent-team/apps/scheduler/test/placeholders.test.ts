// Unfinished dependencies must fail explicitly, not pretend to complete work.
import assert from "node:assert/strict"
import { test } from "node:test"
import { AgentManager } from "../src/components/agent-manager.js"
import { SchedulerDatabase } from "../src/components/scheduler-database.js"
import { Vikunja } from "../src/components/vikunja.js"
import { openDatabase } from "../src/db/database.js"
import { TicketStore } from "../src/db/ticket-store.js"

const ticket = { vikunjaTaskId: 42, title: "Build a form", status: "Ready", priority: 1 }

test("SchedulerDatabase placeholders throw without writing tickets or assignments", async () => {
  const database = openDatabase(":memory:")
  try {
    const tickets = new TicketStore(database)
    const schedulerDatabase = new SchedulerDatabase(tickets)
    await assert.rejects(schedulerDatabase.saveTicket(ticket), /saveTicket is not implemented/)
    await assert.rejects(schedulerDatabase.createAssignment({
      ticketId: 1, agentId: 1, assignmentStatus: "running", ticketStatus: "In progress", assignedAt: "2026-11-06T12:00:00.000Z",
    }), /createAssignment is not implemented/)
    assert.deepEqual(tickets.list(), [])
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM assignments").get()?.count, 0)
  } finally {
    database.close()
  }
})

test("AgentManager assignment placeholder throws rather than reporting no available agent", async () => {
  const database = openDatabase(":memory:")
  try {
    const schedulerDatabase = new SchedulerDatabase(new TicketStore(database))
    const agentManager = new AgentManager(schedulerDatabase)
    await assert.rejects(agentManager.assignTicket({ ...ticket, id: 1 }), /assignTicket is not implemented/)
  } finally {
    database.close()
  }
})

test("Vikunja movement placeholder throws without making an HTTP request", async () => {
  const request: typeof fetch = async () => { assert.fail("No card movement should be attempted") }
  const vikunja = new Vikunja({ baseUrl: "http://127.0.0.1:3456", token: "test-token", projectId: 3, viewId: 12 }, request)
  await assert.rejects(vikunja.markInProgress(42), /markInProgress is not implemented/)
})
