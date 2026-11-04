// Contract for the ticket manager. Callers such as the scheduler only see this, so the source of the tickets
// (Vikunja or anything else) can change without touching them.
// There is one method per kanban column in ticketColumns; add a method here when a column is added there.

import type { TicketInterface } from "./ticket.interface.js"

// Column titles used by the scheduler, independent of the ticket source.
export const ticketColumns = {
  ready: "Ready",
  inProgress: "In progress",
  review: "Review",
  retry: "Retry",
  done: "Done",
} as const

// A destination column accepted by the ticket manager.
export type TicketColumn = (typeof ticketColumns)[keyof typeof ticketColumns]

// A label attached to a ticket, independent of the ticket source.
export interface TicketLabelInterface {
  readonly id: string | number
  readonly title: string
}

// Supplies and moves tickets without exposing the underlying source.
export interface TicketManagerInterface {
  // Tickets a worker can pick up now: the unblocked tickets in Ready followed by those in Retry.
  getTickets(): Promise<TicketInterface[]>

  // Tickets waiting to be started.
  getReadyTickets(): Promise<TicketInterface[]>

  // Tickets a worker is working on right now.
  getInProgressTickets(): Promise<TicketInterface[]>

  // Tickets whose work is finished and waiting for review.
  getReviewTickets(): Promise<TicketInterface[]>

  // Tickets that failed or were sent back and should be tried again.
  getRetryTickets(): Promise<TicketInterface[]>

  // Tickets that are complete.
  getDoneTickets(): Promise<TicketInterface[]>

  // Labels attached to the ticket identified by ticketId.
  getLabels(ticketId: TicketInterface["ticketId"]): Promise<TicketLabelInterface[]>

  // Moves a ticket to a destination column; rejects if the ticket or column cannot be moved.
  moveTo(ticketId: TicketInterface["ticketId"], column: TicketColumn): Promise<void>
}
