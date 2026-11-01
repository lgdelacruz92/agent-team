// Pure: pick the next ticket from board data. No I/O.

export type Status = "ready" | "inProgress" | "review" | "retry" | "done"

export interface Blocker {
  id: number
  status: Status | null
}

export interface Ticket {
  id: number
  title: string
  description: string
  dueDate: string | null
  status: Status | null
  /** N from the GOAL-N label, or null when the ticket has none. */
  goal: number | null
  blockers: Blocker[]
  /** How many tickets this one blocks. */
  blockingCount: number
  /** Number of "run failed" markers the controller has written on the ticket. */
  failures: number
}

export interface Skipped {
  id: number
  title: string
  reason: string
}

export interface Selection {
  queue: Ticket[]
  skipped: Skipped[]
}

export const hasAcceptanceCriteria = (description: string) => /acceptance criteria/i.test(description)

/** Why a ticket cannot be handed to the worker, or null when it is ready. */
export function gateProblem(ticket: Ticket): string | null {
  if (!hasAcceptanceCriteria(ticket.description)) return "the description has no acceptance criteria"
  return null
}

/**
 * Candidates are tickets in Ready or Retry whose blockers are all Done. Tickets that fail the readiness
 * gate or have failed too many times are skipped with a reason. The queue is ordered: Retry first, lowest
 * GOAL-N, most dependents, lowest id.
 */
export function select(tickets: Ticket[], opts: { maxFailures: number }): Selection {
  const skipped: Skipped[] = []
  const queue: Ticket[] = []

  for (const ticket of tickets) {
    if (ticket.status !== "ready" && ticket.status !== "retry") continue
    if (ticket.blockers.some((b) => b.status !== "done")) continue
    if (ticket.failures >= opts.maxFailures) {
      skipped.push({ id: ticket.id, title: ticket.title, reason: `failed ${ticket.failures} times` })
      continue
    }
    const problem = gateProblem(ticket)
    if (problem) {
      skipped.push({ id: ticket.id, title: ticket.title, reason: problem })
      continue
    }
    queue.push(ticket)
  }

  queue.sort(
    (a, b) =>
      Number(b.status === "retry") - Number(a.status === "retry") ||
      (a.goal ?? Infinity) - (b.goal ?? Infinity) ||
      b.blockingCount - a.blockingCount ||
      a.id - b.id,
  )
  return { queue, skipped }
}

/** Candidates before the gate: needed to know whose comments to load. */
export function unblocked(tickets: Ticket[]): Ticket[] {
  return tickets.filter(
    (t) => (t.status === "ready" || t.status === "retry") && t.blockers.every((b) => b.status === "done"),
  )
}
