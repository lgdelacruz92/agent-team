// Exercises retry checks with real SQLite stores and a fake board.
import assert from "node:assert/strict"
import { test } from "node:test"
import { AgentManager } from "../src/components/agent-manager.js"
import { Scheduler } from "../src/components/scheduler.js"
import { SchedulerDatabase } from "../src/components/scheduler-database.js"
import { SharedLock } from "../src/components/shared-lock.js"
import { Vikunja } from "../src/components/vikunja.js"
import { AgentStore } from "../src/db/agent-store.js"
import { AssignmentStore } from "../src/db/assignment-store.js"
import { TicketStore } from "../src/db/ticket-store.js"
import { createTestDatabase } from "./fixtures/database.js"

test("a real Retry count permits a second attempt and flags the ticket at the limit", async () => {
  const database = createTestDatabase()
  try {
    const tickets = new TicketStore(database)
    const agents = new AgentStore(database)
    const assignments = new AssignmentStore(database)
    const ticket = tickets.create({ vikunjaTaskId: 42, title: "Ticket", status: "Retry", priority: 0, presentOnBoard: true })
    const agent = agents.create({ name: "agent", status: "idle" })
    const first = assignments.create({ ticketId: ticket.id, agentId: agent.id, status: "failed", completedAt: "2026-01-01" })
    const execution = database.prepare(`
      INSERT INTO executions (assignment_id, status, created_at, work_requested_at)
      VALUES (?, 'failed', '2026-01-01', '2026-01-01')
    `)
    execution.run(first.id)
    const schedulerDatabase = new SchedulerDatabase(database)
    let status = "Retry"
    const scheduler = new Scheduler({
      async getTickets() { return [{ vikunjaTaskId: 42, title: "Ticket", status, priority: 0 }] },
      async moveToFlagged(taskId) { assert.equal(taskId, 42); status = "Flagged tickets" },
    }, schedulerDatabase, new AgentManager(schedulerDatabase, agents, assignments), new SharedLock(database), 2)

    await scheduler.runOnce()
    const second = assignments.list().find((item) => item.id !== first.id)
    assert.ok(second)
    execution.run(second.id)
    assignments.update(second.id, { ...second, status: "failed", completedAt: "2026-01-02" })
    await scheduler.runOnce()
    assert.equal(status, "Flagged tickets")
    assert.equal(assignments.list().length, 2)
    assert.equal(database.prepare("SELECT count(*) AS count FROM locks").get()?.count, 0)
    await scheduler.runOnce()
    assert.equal(tickets.get(ticket.id)?.status, "Flagged tickets")
    assert.equal(assignments.list().length, 2)
  } finally {
    database.close()
  }
})

for (const failure of ["unchanged", "uncertain"] as const) {
  test(`failed flag move (${failure}) refetches the board and never creates an extra assignment`, async () => {
    const database = createTestDatabase()
    try {
      const tickets = new TicketStore(database)
      const agents = new AgentStore(database)
      const assignments = new AssignmentStore(database)
      const ticket = tickets.create({ vikunjaTaskId: 42, title: "Ticket", status: "Retry", priority: 0, presentOnBoard: true })
      const agent = agents.create({ name: "agent", status: "idle" })
      const previous = assignments.create({ ticketId: ticket.id, agentId: agent.id, status: "failed", completedAt: "2026-01-01" })
      database.prepare(`
        INSERT INTO executions (assignment_id, status, created_at, work_requested_at)
        VALUES (?, 'failed', '2026-01-01', '2026-01-01')
      `).run(previous.id)

      let status = "Retry"
      let posts = 0
      let gets = 0
      const request: typeof fetch = async (_url, init) => {
        if (init?.method === "POST") {
          posts += 1
          assert.ok(database.prepare("SELECT owner FROM locks WHERE name = 'ticket-scheduling'").get())
          if (posts === 1 && failure === "unchanged") return new Response(null, { status: 500 })
          status = "Flagged tickets"
          if (posts === 1 && failure === "uncertain") throw new Error("response lost")
          return new Response(null, { status: 200 })
        }
        gets += 1
        const task = { id: 42, title: "Ticket", priority: 0 }
        return new Response(JSON.stringify([
          { id: 1, title: "Retry", count: status === "Retry" ? 1 : 0, tasks: status === "Retry" ? [task] : [] },
          { id: 2, title: "Flagged tickets", count: status === "Flagged tickets" ? 1 : 0, tasks: status === "Flagged tickets" ? [task] : [] },
        ]), { headers: { "Content-Type": "application/json" } })
      }
      const vikunja = new Vikunja({ baseUrl: "https://example.invalid", token: "fake", projectId: 3, viewId: 12 }, request)
      const schedulerDatabase = new SchedulerDatabase(database)
      const scheduler = new Scheduler(vikunja, schedulerDatabase, new AgentManager(schedulerDatabase, agents, assignments), new SharedLock(database), 1)

      await assert.rejects(scheduler.runOnce(), failure === "unchanged" ? /HTTP 500/ : /response lost/)
      assert.equal(assignments.list().length, 1)
      assert.equal(database.prepare("SELECT count(*) AS count FROM locks").get()?.count, 0)
      await scheduler.runOnce()
      assert.equal(status, "Flagged tickets")
      assert.equal(posts, failure === "unchanged" ? 2 : 1)
      assert.ok(gets >= 3)
      assert.equal(assignments.list().length, 1)
      await scheduler.runOnce()
      assert.equal(tickets.get(ticket.id)?.status, "Flagged tickets")
      assert.equal(assignments.list().length, 1)
    } finally {
      database.close()
    }
  })
}
