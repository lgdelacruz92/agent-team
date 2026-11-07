// Coordinates one scheduling pass using the component interfaces.
import type { AgentManagerInterface } from "../interfaces/agent-manager.interface.js"
import type { SchedulerDatabaseInterface } from "../interfaces/scheduler-database.interface.js"
import type { SchedulerInterface } from "../interfaces/scheduler.interface.js"
import type { VikunjaInterface } from "../interfaces/vikunja.interface.js"

export class Scheduler implements SchedulerInterface {
  constructor(
    private readonly vikunja: VikunjaInterface,
    private readonly database: SchedulerDatabaseInterface,
    private readonly agentManager: AgentManagerInterface,
  ) {}

  async runOnce(): Promise<void> {
    const tickets = await this.vikunja.getTickets()

    await this.database.syncTickets(tickets)

    // Trust the database's readiness rules and ordering; attempt one ticket per pass.
    const readyTickets = await this.database.getReadyTickets()
    const nextTicket = readyTickets[0]

    if (!nextTicket) {
      return
    }

    // The agent manager records the assignment; the resource manager handles execution.
    await this.agentManager.assignTicket(nextTicket)
  }
}
