// Turns Vikunja tasks into TicketInterface objects the scheduler understands.
// It is the bridge between the Vikunja service and the scheduler, so neither needs to know about the other.

import type { TicketInterface } from "../interfaces/ticket.interface.js"
import type { TicketColumn, TicketLabelInterface, TicketManagerInterface } from "../interfaces/ticketmanager.interface.js"
import type { VikunjaServiceInterface } from "../interfaces/vikunja.service.interface.js"
import { vikunjaColumns } from "../interfaces/vikunja.types.js"
import type { VikunjaColumn, VikunjaTaskInterface } from "../interfaces/vikunja.types.js"

// Converts a Vikunja task into the ticket shape the scheduler and workers use.
const toTicket = (task: VikunjaTaskInterface): TicketInterface => {
  return {
    ticketId: task.id,
    title: task.title,
    description: task.description,
  }
}

// Reads Vikunja tasks through the service and presents them as tickets.
export class TicketManager implements TicketManagerInterface {
  constructor(private readonly vikunja: VikunjaServiceInterface) {}

  // Tickets a worker can pick up now: unblocked Ready tickets followed by Retry tickets.
  // Retry tickets are not checked for blockers: they were already started once.
  async getTickets(): Promise<TicketInterface[]> {
    const ready = await this.vikunja.getReadyUnblockedTasks()
    const retry = await this.vikunja.getTasks(vikunjaColumns.retry)

    return [...ready, ...retry].map(toTicket)
  }

  // Tickets waiting to be started.
  getReadyTickets(): Promise<TicketInterface[]> {
    return this.ticketsIn(vikunjaColumns.ready)
  }

  // Tickets a worker is working on right now.
  getInProgressTickets(): Promise<TicketInterface[]> {
    return this.ticketsIn(vikunjaColumns.inProgress)
  }

  // Tickets whose work is finished and waiting for review.
  getReviewTickets(): Promise<TicketInterface[]> {
    return this.ticketsIn(vikunjaColumns.review)
  }

  // Tickets that should be tried again.
  getRetryTickets(): Promise<TicketInterface[]> {
    return this.ticketsIn(vikunjaColumns.retry)
  }

  // Tickets that are complete.
  getDoneTickets(): Promise<TicketInterface[]> {
    return this.ticketsIn(vikunjaColumns.done)
  }

  // Look up a ticket's labels by its Vikunja task ID.
  async getLabels(ticketId: TicketInterface["ticketId"]): Promise<TicketLabelInterface[]> {
    if (typeof ticketId !== "number") {
      throw new Error(`Vikunja task ID must be a number: ${ticketId}`)
    }

    return this.vikunja.getLabels(ticketId)
  }

  // Vikunja identifies tasks by number, even though other task sources may use string IDs.
  async moveTo(ticketId: TicketInterface["ticketId"], column: TicketColumn): Promise<void> {
    if (typeof ticketId !== "number") {
      throw new Error(`Vikunja task ID must be a number: ${ticketId}`)
    }

    await this.vikunja.moveToColumn(ticketId, column)
  }

  // Reads Vikunja tasks from a column and converts them to tickets in the order returned.
  private async ticketsIn(column: VikunjaColumn): Promise<TicketInterface[]> {
    const tasks = await this.vikunja.getTasks(column)

    return tasks.map(toTicket)
  }
}
