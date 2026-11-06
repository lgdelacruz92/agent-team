// Persists ticket-to-agent assignments, including their start and completion times.
import type { DatabaseSync } from "node:sqlite"

export interface AssignmentRecord {
  id: number
  ticketId: number
  agentId: number
  status: string
  assignedAt: string
  completedAt: string | null
}

export interface AssignmentInput {
  ticketId: number
  agentId: number
  status: string
  assignedAt?: string
  completedAt?: string | null
}

const columns = `id, ticket_id AS ticketId, agent_id AS agentId, status,
  assigned_at AS assignedAt, completed_at AS completedAt`

// Uses the same database as TicketStore and AgentStore so foreign keys are enforced.
export class AssignmentStore {
  constructor(private readonly database: DatabaseSync) {}

  // New assignments default to the current UTC time and no completion time.
  create(assignment: AssignmentInput): AssignmentRecord {
    return this.database.prepare(`
      INSERT INTO assignments (ticket_id, agent_id, status, assigned_at, completed_at)
      VALUES (?, ?, ?, ?, ?) RETURNING ${columns}
    `).get(
      assignment.ticketId,
      assignment.agentId,
      assignment.status,
      assignment.assignedAt ?? new Date().toISOString(),
      assignment.completedAt ?? null,
    ) as unknown as AssignmentRecord
  }

  get(id: number): AssignmentRecord | undefined {
    return this.database.prepare(`SELECT ${columns} FROM assignments WHERE id = ?`).get(id) as unknown as AssignmentRecord | undefined
  }

  list(): AssignmentRecord[] {
    return this.database.prepare(`SELECT ${columns} FROM assignments ORDER BY id`).all() as unknown as AssignmentRecord[]
  }

  listByTicketId(ticketId: number): AssignmentRecord[] {
    return this.database.prepare(`SELECT ${columns} FROM assignments WHERE ticket_id = ? ORDER BY id`).all(ticketId) as unknown as AssignmentRecord[]
  }

  listByAgentId(agentId: number): AssignmentRecord[] {
    return this.database.prepare(`SELECT ${columns} FROM assignments WHERE agent_id = ? ORDER BY id`).all(agentId) as unknown as AssignmentRecord[]
  }

  // Replaces all mutable fields; pass null to clear a completion timestamp.
  update(id: number, assignment: Omit<AssignmentRecord, "id">): AssignmentRecord | undefined {
    return this.database.prepare(`
      UPDATE assignments SET ticket_id = ?, agent_id = ?, status = ?, assigned_at = ?, completed_at = ?
      WHERE id = ? RETURNING ${columns}
    `).get(
      assignment.ticketId,
      assignment.agentId,
      assignment.status,
      assignment.assignedAt,
      assignment.completedAt,
      id,
    ) as unknown as AssignmentRecord | undefined
  }

  delete(id: number): boolean {
    return this.database.prepare("DELETE FROM assignments WHERE id = ?").run(id).changes > 0
  }
}
