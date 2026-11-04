// Contract for a unit of work the scheduler hands to a worker, independent of its source.

// A ticket the controller can hand to a worker.
export interface TicketInterface {
  // Unique within its source. Used to name the session and the branch.
  readonly ticketId: string | number

  // Short name of the ticket.
  readonly title: string

  // What the worker is asked to do.
  readonly description: string
}
