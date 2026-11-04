// Builds the prompt an agent receives for a ticket.
import type { TicketInterface } from "../interfaces/ticket.interface.js"

// The prompt for an agent: the ticket and the branch to work on, as the agents' instructions expect.
export const ticketPrompt = (ticket: TicketInterface): string => {
  const slug = ticket.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

  return [
    `Ticket #${ticket.ticketId}: ${ticket.title}`,
    "",
    ticket.description,
    "",
    `Branch: ticket-${ticket.ticketId}-${slug}`,
  ].join("\n")
}
