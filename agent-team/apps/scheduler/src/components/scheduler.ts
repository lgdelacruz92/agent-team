// Coordinates one scheduling pass using the component interfaces.
import type { AgentManagerInterface } from "../interfaces/agent-manager.interface.js"
import type { SchedulerDatabaseInterface } from "../interfaces/scheduler-database.interface.js"
import type { SchedulerInterface } from "../interfaces/scheduler.interface.js"
import type { SharedLockInterface } from "../interfaces/shared-lock.interface.js"
import type { VikunjaInterface } from "../interfaces/vikunja.interface.js"

export class Scheduler implements SchedulerInterface {
  constructor(
    private readonly vikunja: VikunjaInterface,
    private readonly database: SchedulerDatabaseInterface,
    private readonly agentManager: AgentManagerInterface,
    private readonly lock: SharedLockInterface,
    private readonly maxAttempts: number,
  ) {}

  async runOnce(): Promise<void> {
    const owner = await this.lock.tryAcquire()
    if (owner === null) return

    let passFailed = false
    let passError: unknown
    try {
      const tickets = await this.vikunja.getTickets()

      await this.database.syncTickets(tickets)

      // Trust the database's readiness rules and ordering; attempt one ticket per pass.
      const readyTickets = await this.database.getReadyTickets()
      const nextTicket = readyTickets[0]

      if (!nextTicket) return

      if (nextTicket.status === "Retry") {
        const attempts = await this.database.countAttempts(nextTicket.id)
        if (attempts >= this.maxAttempts) {
          await this.vikunja.moveToFlagged(nextTicket.vikunjaTaskId)
          return
        }
      }

      // The agent manager records the assignment; the resource manager handles execution.
      await this.agentManager.assignTicket(nextTicket)
    } catch (error) {
      passFailed = true
      passError = error
      throw error
    } finally {
      try {
        await this.lock.release(owner)
      } catch (error) {
        if (passFailed) throw new AggregateError([passError, error], "Scheduling pass and shared lock release failed")
        throw error
      }
    }
  }
}
