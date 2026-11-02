// Pure: pick the next ticket from board data. No I/O.
import type { Selection, Skipped, Ticket } from "../interfaces/ticket.js"

// True when the description has an "Acceptance criteria" (or "Acceptance checklist") section.
export const hasAcceptanceCriteria = (description: string): boolean => /acceptance (criteria|checklist)/i.test(description)

// Why a ticket cannot be handed to the worker, or null when it is ready.
export function gateProblem(ticket: Ticket): string | null {
  if (!hasAcceptanceCriteria(ticket.description)) {
    return "the description has no acceptance criteria"
  }

  return null
}

// Ranks tickets: lowest GOAL-N, most dependents, lowest id.
function compareTickets(a: Ticket, b: Ticket): number {
  // A ticket without a GOAL-N label sorts after every labelled one.
  const goalA = a.goal ?? Infinity
  const goalB = b.goal ?? Infinity
  if (goalA !== goalB) {
    return goalA - goalB
  }

  if (a.blockingCount !== b.blockingCount) {
    return b.blockingCount - a.blockingCount
  }

  return a.id - b.id
}

// Candidates are tickets in the Ready column whose blockers are all Done.
// Tickets that fail the readiness gate or failed too many times are skipped with a reason.
export function select(tickets: Ticket[], opts: { maxFailures: number }): Selection {
  const skipped: Skipped[] = []
  const queue: Ticket[] = []

  for (const ticket of tickets) {
    if (ticket.status !== "ready") {
      continue
    }

    // A blocker in Review still blocks: the CTO has not accepted it yet.
    if (ticket.blockers.some((blocker) => blocker.status !== "done")) {
      continue
    }

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

  queue.sort(compareTickets)

  return { queue, skipped }
}

// Candidates before the gate: tells the caller whose comments to load.
export function unblocked(tickets: Ticket[]): Ticket[] {
  return tickets.filter((ticket) => {
    return ticket.status === "ready" && ticket.blockers.every((blocker) => blocker.status === "done")
  })
}
