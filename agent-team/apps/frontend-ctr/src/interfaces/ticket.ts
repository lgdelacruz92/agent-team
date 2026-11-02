// Types that describe tickets as the scheduler sees them.

// The Kanban column a ticket sits in.
export type Status = "ready" | "inProgress" | "review" | "retry" | "done"

// A ticket that blocks another one, with its current status (null when unknown).
export interface Blocker {
  id: number
  status: Status | null
}

// One Vikunja task, reduced to what the scheduler needs.
export interface Ticket {
  id: number
  title: string
  description: string
  dueDate: string | null
  status: Status | null

  // Title of the Kanban column the ticket sits in, exactly as shown on the board.
  column: string | null

  // N from the GOAL-N label, or null when the ticket has none.
  goal: number | null
  blockers: Blocker[]

  // How many tickets this one blocks.
  blockingCount: number

  // Number of "run failed" markers the controller has written on the ticket.
  failures: number
}

// A ticket that was passed over, and why.
export interface Skipped {
  id: number
  title: string
  reason: string
}

// The result of choosing the next ticket: an ordered queue plus the tickets that were skipped.
export interface Selection {
  queue: Ticket[]
  skipped: Skipped[]
}
