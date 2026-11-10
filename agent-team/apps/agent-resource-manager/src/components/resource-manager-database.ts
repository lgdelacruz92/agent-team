// Shared SQLite operations used by assignment reconciliation.
import type { DatabaseSync, SQLOutputValue } from "node:sqlite"
import { AgentDatabase } from "./agent-database.js"
import type { Assignment, Execution, ExecutionStatus, ResourceManagerDatabaseInterface, Ticket } from "../interfaces/resource-manager-database.interface.js"

type Row = Record<string, SQLOutputValue>

function number(row: Row, key: string): number {
  const value = row[key]
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`Invalid ${key} in shared database`)
  return value
}

function text(row: Row, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new Error(`Invalid ${key} in shared database`)
  return value
}

function nullableText(row: Row, key: string): string | null {
  return row[key] === null ? null : text(row, key)
}

function assignment(row: Row): Assignment {
  return { id: number(row, "id"), ticketId: number(row, "ticket_id"), agentId: number(row, "agent_id"),
    status: text(row, "status"), assignedAt: text(row, "assigned_at"), completedAt: nullableText(row, "completed_at") }
}

function execution(row: Row): Execution {
  const status = text(row, "status")
  if (!["starting", "running", "succeeded", "failed"].includes(status)) throw new Error(`Invalid execution status ${status}`)
  return { id: number(row, "id"), assignmentId: number(row, "assignment_id"), sessionId: nullableText(row, "session_id"),
    status: status as ExecutionStatus, createdAt: text(row, "created_at"), workRequestedAt: nullableText(row, "work_requested_at"),
    startedAt: nullableText(row, "started_at"), finishedAt: nullableText(row, "finished_at"), failureReason: nullableText(row, "failure_reason") }
}

export class ResourceManagerDatabase extends AgentDatabase implements ResourceManagerDatabaseInterface {
  constructor(private readonly db: DatabaseSync) { super(db) }

  async listIncompleteAssignments(): Promise<Assignment[]> {
    return this.db.prepare("SELECT * FROM assignments WHERE completed_at IS NULL ORDER BY id").all().map(assignment)
  }

  async getAssignment(id: number): Promise<Assignment | null> {
    const row = this.db.prepare("SELECT * FROM assignments WHERE id = ?").get(id)
    return row ? assignment(row) : null
  }

  async getTicket(id: number): Promise<Ticket | null> {
    const row = this.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id)
    if (!row) return null
    const present = number(row, "present_on_board")
    if (present !== 0 && present !== 1) throw new Error("Invalid present_on_board in shared database")
    return { id: number(row, "id"), vikunjaTaskId: number(row, "vikunja_task_id"), title: text(row, "title"),
      status: text(row, "status"), priority: number(row, "priority"), presentOnBoard: present === 1 }
  }

  async updateAssignmentStatus(id: number, status: string): Promise<void> {
    this._update("UPDATE assignments SET status = ? WHERE id = ? AND completed_at IS NULL", status, id)
  }

  async completeAssignment(id: number, completedAt: string): Promise<void> {
    this._update("UPDATE assignments SET completed_at = ? WHERE id = ? AND completed_at IS NULL", completedAt, id)
  }

  async getLatestExecution(assignmentId: number): Promise<Execution | null> {
    const row = this.db.prepare("SELECT * FROM executions WHERE assignment_id = ? ORDER BY id DESC LIMIT 1").get(assignmentId)
    return row ? execution(row) : null
  }

  async createExecution(assignmentId: number, createdAt: string): Promise<Execution> {
    const result = this.db.prepare("INSERT INTO executions (assignment_id, status, created_at) VALUES (?, 'starting', ?)").run(assignmentId, createdAt)
    const row = this.db.prepare("SELECT * FROM executions WHERE id = ?").get(result.lastInsertRowid)
    if (!row) throw new Error("Created execution was not found")
    return execution(row)
  }

  async saveSession(id: number, sessionId: string): Promise<void> {
    this._update("UPDATE executions SET session_id = ? WHERE id = ? AND session_id IS NULL", sessionId, id)
  }

  async recordWorkRequest(id: number, requestedAt: string): Promise<void> {
    this._update("UPDATE executions SET work_requested_at = ? WHERE id = ? AND work_requested_at IS NULL", requestedAt, id)
  }

  async markRunning(id: number, startedAt: string): Promise<void> {
    this._update("UPDATE executions SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ? AND status = 'starting'", startedAt, id)
  }

  async finishExecution(id: number, status: "succeeded" | "failed", finishedAt: string, reason: string | null): Promise<void> {
    this._update("UPDATE executions SET status = ?, finished_at = ?, failure_reason = ? WHERE id = ? AND status IN ('starting', 'running')", status, finishedAt, reason, id)
  }

  private _update(sql: string, ...values: (number | string | null)[]): void {
    if (this.db.prepare(sql).run(...values).changes !== 1) throw new Error("Shared database update did not affect one row")
  }
}
