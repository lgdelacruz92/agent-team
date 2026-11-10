// Reconciliation against the real shared schema and controlled services.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { AssignmentReconciler } from "../src/components/assignment-reconciler.js"
import { ResourceManagerDatabase } from "../src/components/resource-manager-database.js"
import { SharedLock } from "../src/components/shared-lock.js"
import { SharedLock as SchedulerLock } from "../../scheduler/src/components/shared-lock.js"
import { Scheduler } from "../../scheduler/src/components/scheduler.js"
import { SchedulerDatabase } from "../../scheduler/src/components/scheduler-database.js"
import { AgentManager } from "../../scheduler/src/components/agent-manager.js"
import { AgentStore } from "../../scheduler/src/db/agent-store.js"
import { AssignmentStore } from "../../scheduler/src/db/assignment-store.js"
import type { OpencodeAgentClientInterface, OpencodeSessionState, OpencodeState } from "../src/interfaces/opencode-agent-client.interface.js"
import type { ResourceManagerColumn, VikunjaInterface } from "../src/interfaces/vikunja.interface.js"

class FakeAgent implements OpencodeAgentClientInterface {
  readonly url = "http://agent"
  serverState: OpencodeState = "idle"
  session: OpencodeSessionState = "idle"
  busyAt: number | null = null
  idleAt: number | null = null
  prompts: string[] = []
  created = 0
  aborted = 0
  promptError = false
  async state() { return this.serverState }
  async sessionState() { return this.session }
  async sessionActivity() {
    return { state: this.session, busyAt: this.session === "busy" ? this.busyAt ?? 10 : this.busyAt, idleAt: this.idleAt }
  }
  async createSession() { this.created += 1; return `ses_${this.created}` }
  async prompt(_id: string, text: string) { this.prompts.push(text); if (this.promptError) throw new Error("uncertain prompt") }
  async abort() { this.aborted += 1 }
}

class FakeVikunja implements VikunjaInterface {
  moves: ResourceManagerColumn[] = []
  fetchError = false
  moveError = false
  async getTask(id: number) {
    if (this.fetchError) throw new Error("task unavailable")
    return { id, title: "Fix ticket", description: "Full task description" }
  }
  async moveToColumn(_id: number, column: ResourceManagerColumn) {
    if (this.moveError) throw new Error("move uncertain")
    this.moves.push(column)
  }
}

function setup(timeoutMs: number | null = null) {
  const db = new DatabaseSync(":memory:")
  db.exec(readFileSync(new URL("../../shared-db/seed.sql", import.meta.url), "utf8"))
  db.exec("INSERT INTO tickets VALUES (1, 101, 'Fix ticket', 'Ready', 1, 1); INSERT INTO agents VALUES (1, 'worker', 'idle', 'http://agent'); INSERT INTO assignments VALUES (1, 1, 1, 'assigned', '2026-01-01T00:00:00.000Z', NULL)")
  const agent = new FakeAgent()
  const vikunja = new FakeVikunja()
  const database = new ResourceManagerDatabase(db)
  const lock = new SharedLock(db)
  const manager = new AssignmentReconciler(database, vikunja, lock, () => agent, timeoutMs, () => new Date("2026-01-01T00:01:00.000Z"))
  return { db, agent, vikunja, database, manager }
}

test("dispatches, observes and completes while coordinating with the scheduler lock", async () => {
  const { db, agent, vikunja, database, manager } = setup()
  try {
    await manager.runOnce()
    assert.deepEqual(agent.prompts, ["Fix ticket\n\nFull task description"])
    assert.equal((await database.getLatestExecution(1))?.workRequestedAt, "2026-01-01T00:01:00.000Z")
    agent.session = "busy"
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.status, "running")
    assert.deepEqual(vikunja.moves, ["In progress"])
    agent.session = "idle"
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.status, "succeeded")
    const schedulerLock = new SchedulerLock(db)
    const owner = await schedulerLock.tryAcquire()
    assert.ok(owner)
    await manager.runOnce()
    assert.equal((await database.getAssignment(1))?.completedAt, null)
    await schedulerLock.release(owner)
    await manager.runOnce()
    assert.deepEqual(vikunja.moves, ["In progress", "Done"])
    assert.ok((await database.getAssignment(1))?.completedAt)
    assert.equal((await database.listAgents())[0].status, "idle")
  } finally { db.close() }
})

test("finished successful executions reconcile the agent state before completion", async () => {
  const cases: { state: OpencodeState; expectedStatus: string }[] = [
    { state: "idle", expectedStatus: "idle" },
    { state: "unreachable", expectedStatus: "needs_review" },
    { state: "busy", expectedStatus: "busy" },
    { state: "unknown", expectedStatus: "busy" },
  ]
  for (const { state, expectedStatus } of cases) {
    const { db, agent, vikunja, database, manager } = setup()
    try {
      const execution = await database.createExecution(1, "2026-01-01T00:00:00.000Z")
      await database.finishExecution(execution.id, "succeeded", "2026-01-01T00:01:00.000Z", null)
      await database.updateAgentStatus(1, "busy")
      agent.serverState = state
      await manager.runOnce()
      assert.equal((await database.listAgents())[0].status, expectedStatus)
      assert.deepEqual(vikunja.moves, ["Done"])
      assert.ok((await database.getAssignment(1))?.completedAt)
    } finally { db.close() }
  }
})

test("finished timed-out execution retries abort before moving the ticket to Retry", async () => {
  const { db, agent, vikunja, database, manager } = setup()
  try {
    const execution = await database.createExecution(1, "2026-01-01T00:00:00.000Z")
    await database.saveSession(execution.id, "old")
    await database.finishExecution(execution.id, "failed", "2026-01-01T00:01:00.000Z", "execution timed out")
    await manager.runOnce()
    assert.equal(agent.aborted, 1)
    assert.deepEqual(vikunja.moves, ["Retry"])
    assert.ok((await database.getAssignment(1))?.completedAt)
  } finally { db.close() }
})

test("logs every task fetch failure and preserves the reservation without creating an attempt", async (t) => {
  const { db, vikunja, database, manager } = setup()
  try {
    const errors = t.mock.method(console, "error", () => {})
    vikunja.fetchError = true
    await assert.rejects(manager.runOnce(), AggregateError)
    await assert.rejects(manager.runOnce(), AggregateError)
    assert.equal(errors.mock.callCount(), 2)
    assert.match(String(errors.mock.calls[0].arguments[0]), /assignment 1/)
    assert.equal(await database.getLatestExecution(1), null)
    assert.equal((await database.getAssignment(1))?.completedAt, null)
    vikunja.fetchError = false
    await manager.runOnce()
    assert.ok(await database.getLatestExecution(1))
  } finally { db.close() }
})

test("reuses a saved idle session and watches a busy unrecorded session", async () => {
  const { db, agent, database, manager } = setup()
  try {
    const execution = await database.createExecution(1, "2026-01-01T00:00:00.000Z")
    await database.saveSession(execution.id, "old_session")
    agent.session = "busy"
    await manager.runOnce()
    assert.equal(agent.prompts.length, 0)
    agent.session = "idle"
    await manager.runOnce()
    assert.equal(agent.created, 0)
    assert.equal(agent.prompts.length, 1)
    assert.ok((await database.getLatestExecution(1))?.workRequestedAt)
  } finally { db.close() }
})

test("fetches before creating an execution, but waits for an idle agent before fetching again on recovery", async () => {
  const { db, agent, vikunja, database, manager } = setup()
  try {
    let fetches = 0
    const getTask = vikunja.getTask.bind(vikunja)
    vikunja.getTask = async (id) => {
      fetches += 1
      if (fetches === 1) assert.equal(await database.getLatestExecution(1), null)
      return getTask(id)
    }
    agent.serverState = "busy"
    await manager.runOnce()
    assert.equal(fetches, 1)
    assert.ok(await database.getLatestExecution(1))
    assert.equal(agent.created, 0)

    await manager.runOnce()
    assert.equal(fetches, 1)
    agent.serverState = "idle"
    await manager.runOnce()
    assert.equal(fetches, 2)
    assert.equal(agent.created, 1)
    assert.equal(agent.prompts.length, 1)
  } finally { db.close() }
})

test("a confirmed missing unrecorded session creates a new execution; a recorded one moves to Retry", async () => {
  const { db, agent, vikunja, database, manager } = setup()
  try {
    const execution = await database.createExecution(1, "2026-01-01T00:00:00.000Z")
    await database.saveSession(execution.id, "old")
    agent.session = "missing"
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.failureReason, "missing session before work request")
    agent.session = "idle"
    await manager.runOnce()
    assert.equal(agent.created, 1)
    assert.notEqual((await database.getLatestExecution(1))?.id, execution.id)
    agent.session = "missing"
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.failureReason, "missing session after work request")
    await manager.runOnce()
    assert.deepEqual(vikunja.moves, ["Retry"])
    assert.ok((await database.getAssignment(1))?.completedAt)
  } finally { db.close() }
})

test("uncertain prompt is counted after sending and is not sent again on recovery", async () => {
  const { db, agent, database, manager } = setup()
  try {
    agent.promptError = true
    await assert.rejects(manager.runOnce(), AggregateError)
    assert.ok((await database.getLatestExecution(1))?.workRequestedAt)
    agent.session = "busy"
    await manager.runOnce()
    assert.equal(agent.prompts.length, 1)
  } finally { db.close() }
})

test("unreachable session is flagged and failed even when abort fails", async () => {
  const { db, agent, vikunja, database, manager } = setup()
  try {
    await manager.runOnce()
    agent.session = "unreachable"
    agent.abort = async () => { throw new Error("offline") }
    await manager.runOnce()
    assert.equal((await database.listAgents())[0].status, "needs_review")
    assert.equal((await database.getLatestExecution(1))?.status, "failed")
    await manager.runOnce()
    assert.deepEqual(vikunja.moves, ["Retry"])
  } finally { db.close() }
})

test("failed final moves keep the reservation and retry under the shared lock", async () => {
  const { db, agent, vikunja, database, manager } = setup()
  try {
    await manager.runOnce()
    agent.session = "busy"
    await manager.runOnce()
    agent.session = "idle"
    await manager.runOnce()
    vikunja.moveError = true
    await assert.rejects(manager.runOnce(), AggregateError)
    assert.equal((await database.getAssignment(1))?.completedAt, null)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM locks").get()?.n, 0)
    vikunja.moveError = false
    await manager.runOnce()
    assert.ok((await database.getAssignment(1))?.completedAt)
  } finally { db.close() }
})

test("does not mistake the brief idle period after sending for completion; restart follows the agreed rule", async () => {
  const { db, agent, vikunja, database, manager } = setup()
  try {
    await manager.runOnce()
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.status, "starting")
    const restarted = new AssignmentReconciler(database, vikunja, new SharedLock(db), () => agent)
    await restarted.runOnce()
    assert.equal((await database.getLatestExecution(1))?.status, "succeeded")
  } finally { db.close() }
})

test("recognizes a busy and idle interval that happened entirely between polls", async () => {
  const { db, agent, database, manager } = setup()
  try {
    await manager.runOnce()
    agent.busyAt = 10
    agent.idleAt = 20
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.status, "succeeded")
  } finally { db.close() }
})

test("does not mistake old activity on a reused session for the new prompt", async () => {
  const { db, agent, database, manager } = setup()
  try {
    const execution = await database.createExecution(1, "2026-01-01T00:00:00.000Z")
    await database.saveSession(execution.id, "old")
    agent.busyAt = 10
    agent.idleAt = 20
    await manager.runOnce()
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.status, "starting")
    agent.busyAt = 30
    agent.idleAt = 40
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.status, "succeeded")
  } finally { db.close() }
})

test("requires a completed interval and an idle server before success", async () => {
  const { db, agent, database, manager } = setup()
  try {
    await manager.runOnce()
    agent.busyAt = 10
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.status, "starting")
    agent.idleAt = 20
    agent.serverState = "busy"
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.status, "starting")
    agent.serverState = "idle"
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.status, "succeeded")
  } finally { db.close() }
})

test("recognized completed activity wins over an elapsed timeout", async () => {
  const { db, agent, database, manager } = setup(1)
  try {
    await manager.runOnce()
    db.prepare("UPDATE executions SET work_requested_at = ? WHERE id = 1").run("2026-01-01T00:00:00.000Z")
    agent.busyAt = 10
    agent.idleAt = 20
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.status, "succeeded")
    assert.equal(agent.aborted, 0)
  } finally { db.close() }
})

test("does not send work when the pre-send session activity cannot be observed", async () => {
  const { db, agent, database, manager } = setup()
  try {
    agent.session = "unknown"
    await assert.rejects(manager.runOnce(), AggregateError)
    assert.equal(agent.prompts.length, 0)
    assert.equal((await database.getLatestExecution(1))?.workRequestedAt, null)
    agent.session = "idle"
    await manager.runOnce()
    assert.equal(agent.prompts.length, 1)
  } finally { db.close() }
})

test("rechecks a reused session after fetching the task and before sending", async () => {
  const { db, agent, vikunja, database, manager } = setup()
  try {
    const execution = await database.createExecution(1, "2026-01-01T00:00:00.000Z")
    await database.saveSession(execution.id, "old")
    vikunja.getTask = async (id) => {
      agent.session = "busy"
      return { id, title: "Task", description: "Work" }
    }
    await assert.rejects(manager.runOnce(), AggregateError)
    assert.equal(agent.prompts.length, 0)
    assert.equal((await database.getLatestExecution(1))?.workRequestedAt, null)
  } finally { db.close() }
})

test("configured timeout flags and stops a stuck session", async () => {
  const { db, agent, database, manager } = setup(1)
  try {
    const execution = await database.createExecution(1, "2026-01-01T00:00:00.000Z")
    await database.saveSession(execution.id, "old")
    await database.recordWorkRequest(execution.id, "2026-01-01T00:00:00.000Z")
    agent.session = "busy"
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.failureReason, "execution timed out")
    assert.equal((await database.listAgents())[0].status, "needs_review")
    assert.equal(agent.aborted, 1)
  } finally { db.close() }
})

test("a recorded idle session after restart succeeds even if its timeout has passed", async () => {
  const { db, database, manager } = setup(1)
  try {
    const execution = await database.createExecution(1, "2026-01-01T00:00:00.000Z")
    await database.saveSession(execution.id, "old")
    await database.recordWorkRequest(execution.id, "2026-01-01T00:00:00.000Z")
    await manager.runOnce()
    assert.equal((await database.getLatestExecution(1))?.status, "succeeded")
  } finally { db.close() }
})

test("a recorded request without a session ID stays reserved rather than sending duplicate work", async () => {
  const { db, agent, database, manager } = setup()
  try {
    const execution = await database.createExecution(1, "2026-01-01T00:00:00.000Z")
    await database.recordWorkRequest(execution.id, "2026-01-01T00:00:00.000Z")
    await assert.rejects(manager.runOnce(), AggregateError)
    assert.equal(agent.created, 0)
    assert.equal(agent.prompts.length, 0)
    assert.equal((await database.getAssignment(1))?.completedAt, null)
  } finally { db.close() }
})

test("manager pass locks exclude other managers and require the correct owner", async () => {
  const { db } = setup()
  try {
    const first = new SharedLock(db, "resource-manager-pass")
    const second = new SharedLock(db, "resource-manager-pass")
    const owner = await first.tryAcquire()
    assert.ok(owner)
    assert.equal(await second.tryAcquire(), null)
    await assert.rejects(second.release("wrong-owner"), /owner does not match/)
    await first.release(owner)
    const next = await second.tryAcquire()
    assert.ok(next)
    await second.release(next)
  } finally { db.close() }
})

test("retries a database completion failure after a successful card move", async () => {
  const { db, agent, vikunja, database, manager } = setup()
  try {
    await manager.runOnce()
    agent.session = "busy"
    await manager.runOnce()
    agent.session = "idle"
    await manager.runOnce()
    const complete = database.completeAssignment.bind(database)
    database.completeAssignment = async () => { throw new Error("write failed") }
    await assert.rejects(manager.runOnce(), AggregateError)
    assert.equal((await database.getAssignment(1))?.completedAt, null)
    database.completeAssignment = complete
    await manager.runOnce()
    assert.ok((await database.getAssignment(1))?.completedAt)
    assert.deepEqual(vikunja.moves, ["In progress", "Done", "Done"])
  } finally { db.close() }
})

test("scheduler and manager share reservations, attempts, and final board state", async () => {
  const { db, agent, vikunja, database, manager } = setup()
  try {
    db.exec("DELETE FROM assignments; DELETE FROM tickets")
    let boardStatus = "Ready"
    const schedulerDatabase = new SchedulerDatabase(db)
    const scheduler = new Scheduler({
      async getTickets() { return [{ vikunjaTaskId: 101, title: "Fix ticket", status: boardStatus, priority: 1 }] },
      async moveToFlagged() { boardStatus = "Flagged tickets" },
    }, schedulerDatabase, new AgentManager(schedulerDatabase, new AgentStore(db), new AssignmentStore(db)), new SchedulerLock(db), 1)
    vikunja.moveToColumn = async (_id, column) => { boardStatus = column; vikunja.moves.push(column) }
    await scheduler.runOnce()
    const first = (await database.listIncompleteAssignments())[0]
    assert.ok(first)
    await manager.runOnce()
    agent.session = "unreachable"
    await manager.runOnce()
    await manager.runOnce()
    assert.equal(boardStatus, "Retry")
    assert.ok((await database.getAssignment(first.id))?.completedAt)
    assert.equal(await schedulerDatabase.countAttempts(first.ticketId), 1)
    await scheduler.runOnce()
    assert.equal(boardStatus, "Flagged tickets")
    assert.equal((await database.listIncompleteAssignments()).length, 0)
  } finally { db.close() }
})
