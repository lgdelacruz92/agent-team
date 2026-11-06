// Defines how the scheduler asks the agent manager to assign one ticket.
import type { Assignment, SchedulerTicket } from "./scheduler-database.interface.js"

export interface AgentManagerInterface {
  // Return a saved assignment, or null when no agent is available. Errors are not treated as unavailability.
  assignTicket(ticket: SchedulerTicket): Promise<Assignment | null>
}
