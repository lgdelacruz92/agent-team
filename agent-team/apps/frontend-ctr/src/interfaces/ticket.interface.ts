// Contract for a unit of work the scheduler hands to a worker and its task conversion.

import type { VikunjaTaskInterface } from "./vikunja.types.js"

// A label attached to a ticket, independent of the ticket source.
export interface TicketLabelInterface {
  readonly id: string | number
  readonly title: string
}

// A ticket the controller can hand to a worker.
export interface TicketInterface {
  // Unique within its source. Used to name the session and the branch.
  readonly ticketId: string | number

  // Short name of the ticket.
  readonly title: string

  // What the worker is asked to do.
  readonly description: string

  // Fetch the ticket's current labels; rejects when the source cannot be read.
  getLabels(): Promise<TicketLabelInterface[]>

  // Rebuild the task represented by this ticket, including its other task fields.
  toTask(): VikunjaTaskInterface
}
