// Builds the prompt an agent receives for a ticket.
import type { TaskInterface } from "../interfaces/task.interface.js"

// The prompt for an agent: the ticket and the branch to work on, as the agents' instructions expect.
export const taskPrompt = (task: TaskInterface): string => {
  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

  return [
    `Ticket #${task.id}: ${task.title}`,
    "",
    task.description,
    "",
    `Branch: ticket-${task.id}-${slug}`,
  ].join("\n")
}
