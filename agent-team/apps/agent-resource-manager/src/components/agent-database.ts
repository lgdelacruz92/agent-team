// Reads agents and records review flags in the existing shared SQLite database.
import type { DatabaseSync } from "node:sqlite"
import type { Agent, ResourceManagerDatabaseInterface } from "../interfaces/resource-manager-database.interface.js"

// Implements only the database operations needed by the current agent-check pass.
export class AgentDatabase implements Pick<ResourceManagerDatabaseInterface, "listAgents" | "updateAgentStatus"> {
  constructor(private readonly database: DatabaseSync) {}

  async listAgents(): Promise<Agent[]> {
    const rows = this.database.prepare("SELECT id, name, status, url FROM agents ORDER BY id").all()

    return rows.map((row) => {
      if (typeof row.id !== "number" || typeof row.name !== "string" || typeof row.status !== "string"
        || (typeof row.url !== "string" && row.url !== null)) {
        throw new Error("Invalid agent row in shared database")
      }

      return { id: row.id, name: row.name, status: row.status, url: row.url }
    })
  }

  async updateAgentStatus(agentId: number, status: string): Promise<void> {
    const result = this.database.prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, agentId)

    if (result.changes !== 1) {
      throw new Error(`Agent ${agentId} was not found`)
    }
  }
}
