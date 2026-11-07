// Defines the scheduler's database operations without exposing its storage implementation.
import type { VikunjaTicket } from "./vikunja.interface.js"

// The local ID identifies the ticket inside the scheduler database.
export interface SchedulerTicket extends VikunjaTicket {
  id: number
  presentOnBoard: boolean
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
  assignedAt: string
}

export interface SchedulerDatabaseInterface {
  // Atomically reconcile a complete successful board fetch, preserving missing ticket records.
  syncTickets(tickets: VikunjaTicket[]): Promise<void>

  // Return present, unassigned Ready and Retry tickets in local ID order.
  getReadyTickets(): Promise<SchedulerTicket[]>

  // Create an assignment atomically without changing the ticket or agent status.
  // Reject missing/non-ready tickets, unavailable agents, and duplicate active assignments.
  createAssignment(assignment: NewAssignment): Promise<Assignment>
}
