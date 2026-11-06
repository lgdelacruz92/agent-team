// Persists agents independently of their assignments.
import type { DatabaseSync } from "node:sqlite"

export interface AgentRecord {
  id: number
  name: string
  status: string
}

export type AgentInput = Omit<AgentRecord, "id">

// Uses a shared connection; statuses and names have no extra domain restrictions.
export class AgentStore {
  constructor(private readonly database: DatabaseSync) {}

  create(agent: AgentInput): AgentRecord {
    return this.database.prepare(`
      INSERT INTO agents (name, status) VALUES (?, ?) RETURNING id, name, status
    `).get(agent.name, agent.status) as unknown as AgentRecord
  }

  get(id: number): AgentRecord | undefined {
    return this.database.prepare("SELECT id, name, status FROM agents WHERE id = ?").get(id) as unknown as AgentRecord | undefined
  }

  list(): AgentRecord[] {
    return this.database.prepare("SELECT id, name, status FROM agents ORDER BY id").all() as unknown as AgentRecord[]
  }

  // Replaces mutable fields; returns undefined when the local ID does not exist.
  update(id: number, agent: AgentInput): AgentRecord | undefined {
    return this.database.prepare(`
      UPDATE agents SET name = ?, status = ? WHERE id = ? RETURNING id, name, status
    `).get(agent.name, agent.status, id) as unknown as AgentRecord | undefined
  }

  // Referenced agents cannot be deleted until their assignments are removed.
  delete(id: number): boolean {
    return this.database.prepare("DELETE FROM agents WHERE id = ?").run(id).changes > 0
  }
}
