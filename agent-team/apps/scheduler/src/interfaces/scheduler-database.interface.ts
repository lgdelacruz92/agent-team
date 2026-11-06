// Defines the scheduler's database operations without exposing its storage implementation.
import type { VikunjaTicket } from "./vikunja.interface.js"

// The local ID identifies the ticket inside the scheduler database.
export interface SchedulerTicket extends VikunjaTicket {
  id: number
}

export interface Assignment {
  id: number
  ticketId: number
  agentId: number
  status: string
  assignedAt: string
  completedAt: string | null
}

// Values supplied by the agent manager when recording an assignment.
export interface NewAssignment {
  ticketId: number
  agentId: number
  assignmentStatus: string
  ticketStatus: string
  assignedAt: string
}

export interface SchedulerDatabaseInterface {
  // Insert a ticket or update the existing one with the same Vikunja task ID, preserving its local ID.
  saveTicket(ticket: VikunjaTicket): Promise<SchedulerTicket>

  // Return tickets considered ready; ordering and readiness rules are not defined yet.
  getReadyTickets(): Promise<SchedulerTicket[]>

  // Create the assignment and update the local ticket together; both changes succeed or neither does.
  createAssignment(assignment: NewAssignment): Promise<Assignment>
}
