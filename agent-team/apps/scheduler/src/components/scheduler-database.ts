// Provides the scheduler's view of tickets stored in the local database.
import type { TicketStore } from "../db/ticket-store.js"
import type { Assignment, NewAssignment, SchedulerDatabaseInterface, SchedulerTicket } from "../interfaces/scheduler-database.interface.js"
import type { VikunjaTicket } from "../interfaces/vikunja.interface.js"

// Unfinished operations throw explicitly until their implementations are added.
export class SchedulerDatabase implements SchedulerDatabaseInterface {
  constructor(private readonly tickets: TicketStore) {}

  async saveTicket(_ticket: VikunjaTicket): Promise<SchedulerTicket> {
    throw new Error("SchedulerDatabase.saveTicket is not implemented")
  }

  async createAssignment(_assignment: NewAssignment): Promise<Assignment> {
    throw new Error("SchedulerDatabase.createAssignment is not implemented")
  }

  // Ready and Retry tickets are both schedulable; their stored statuses stay unchanged.
  async getReadyTickets(): Promise<SchedulerTicket[]> {
    const tickets = this.tickets.list()

    return tickets.filter((ticket) => ticket.status === "Ready" || ticket.status === "Retry")
  }
}
