// Provides the scheduler's view of tickets stored in the local database.
import type { TicketStore } from "../db/ticket-store.js"
import type { Assignment, NewAssignment, SchedulerDatabaseInterface, SchedulerTicket } from "../interfaces/scheduler-database.interface.js"
import type { VikunjaTicket } from "../interfaces/vikunja.interface.js"

// Unfinished operations throw explicitly until their implementations are added.
export class SchedulerDatabase implements SchedulerDatabaseInterface {
  constructor(private readonly tickets: TicketStore) {}

  async saveTicket(ticket: VikunjaTicket): Promise<SchedulerTicket> {
    const existingTicket = this.tickets.getByVikunjaTaskId(ticket.vikunjaTaskId)

    if (!existingTicket) {
      return this.tickets.create(ticket)
    }

    const savedTicket = this.tickets.update(existingTicket.id, ticket)

    if (!savedTicket) {
      throw new Error(`Ticket ${existingTicket.id} no longer exists`)
    }

    return savedTicket
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
