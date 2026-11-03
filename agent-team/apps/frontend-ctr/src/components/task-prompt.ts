// Builds the prompt an agent receives for a ticket.
import type { VikunjaTaskInterface } from "../interfaces/vikunja.interface.js"

// The prompt for an agent: the ticket and the branch to work on, as the agents' instructions expect.
export const taskPrompt = (task: VikunjaTaskInterface): string => {
  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

  return [
    `Ticket #${task.id}: ${task.title}`,
    "",
    task.description,
    "",
    `Branch: ticket-${task.id}-${slug}`,
  ].join("\n")
}
