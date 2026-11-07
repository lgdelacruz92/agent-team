// Holds the agent manager's dependencies; assignment behavior will be added later.
import type { AgentManagerInterface } from "../interfaces/agent-manager.interface.js"
import type { Assignment, SchedulerDatabaseInterface, SchedulerTicket } from "../interfaces/scheduler-database.interface.js"

export class AgentManager implements AgentManagerInterface {
  constructor(private readonly database: SchedulerDatabaseInterface) {}

  // Explicit placeholder, not a claim that no agents are available.
  async assignTicket(_ticket: SchedulerTicket): Promise<Assignment | null> {
    throw new Error("AgentManager.assignTicket is not implemented")
  }
}
