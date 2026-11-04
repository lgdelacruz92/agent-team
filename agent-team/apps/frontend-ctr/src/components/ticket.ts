// Converts Vikunja tasks to tickets and back while keeping label lookup on the ticket.
import type { TicketInterface, TicketLabelInterface } from "../interfaces/ticket.interface.js"
import type { VikunjaServiceInterface } from "../interfaces/vikunja.service.interface.js"
import type { VikunjaTaskInterface } from "../interfaces/vikunja.types.js"

// A ticket backed by a Vikunja task; retains task fields that are not part of the ticket's public data.
export class Ticket implements TicketInterface {
  readonly ticketId: number
  readonly title: string
  readonly description: string
  private readonly task: VikunjaTaskInterface

  private constructor(task: VikunjaTaskInterface, private readonly vikunja: VikunjaServiceInterface) {
    this.task = { ...task }
    this.ticketId = task.id
    this.title = task.title
    this.description = task.description
  }

  // Creates a ticket from a task without fetching labels until they are requested.
  static fromTask(task: VikunjaTaskInterface, vikunja: VikunjaServiceInterface): Ticket {
    return new Ticket(task, vikunja)
  }

  // Fetches the current labels instead of relying on the task's label snapshot.
  getLabels(): Promise<TicketLabelInterface[]> {
    return this.vikunja.getLabels(this.ticketId)
  }

  // Preserves the original task fields while mapping the ticket's own fields back to the task.
  toTask(): VikunjaTaskInterface {
    return { ...this.task, id: this.ticketId, title: this.title, description: this.description }
  }
}
