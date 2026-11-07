// Provides the scheduler's view of tickets stored in the local database.
import type { TicketStore } from "../db/ticket-store.js"
import type { SchedulerDatabaseInterface, SchedulerTicket } from "../interfaces/scheduler-database.interface.js"

// Only the ready-ticket lookup is implemented so far; the other database operations will follow.
export class SchedulerDatabase implements Pick<SchedulerDatabaseInterface, "getReadyTickets"> {
  constructor(private readonly tickets: TicketStore) {}

  // Ready and Retry tickets are both schedulable; their stored statuses stay unchanged.
  async getReadyTickets(): Promise<SchedulerTicket[]> {
    const tickets = this.tickets.list()

    return tickets.filter((ticket) => ticket.status === "Ready" || ticket.status === "Retry")
  }
}
