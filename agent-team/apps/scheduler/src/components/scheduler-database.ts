// Provides the scheduler's view of tickets stored in the local database.
import type { DatabaseSync } from "node:sqlite"
import { AgentStore } from "../db/agent-store.js"
import { AssignmentStore } from "../db/assignment-store.js"
import { TicketStore } from "../db/ticket-store.js"
import type { Assignment, NewAssignment, SchedulerDatabaseInterface, SchedulerTicket } from "../interfaces/scheduler-database.interface.js"
import type { VikunjaTicket } from "../interfaces/vikunja.interface.js"

// All domain stores share the connection so assignment writes can be atomic.
export class SchedulerDatabase implements SchedulerDatabaseInterface {
  private readonly tickets: TicketStore
  private readonly agents: AgentStore
  private readonly assignments: AssignmentStore

  constructor(private readonly database: DatabaseSync) {
    this.tickets = new TicketStore(database)
    this.agents = new AgentStore(database)
    this.assignments = new AssignmentStore(database)
  }

  async saveTicket(ticket: VikunjaTicket): Promise<SchedulerTicket> {
    const existingTicket = this.tickets.getByVikunjaTaskId(ticket.vikunjaTaskId)

    if (!existingTicket) {
      return this.tickets.create(ticket)
    }

    const savedTicket = this.tickets.update(existingTicket.id, ticket)

    if (!savedTicket) {
      throw new Error(`Ticket ${existingTicket.id} no longer exists`)
    }

    return savedTicket
  }

  async createAssignment(assignment: NewAssignment): Promise<Assignment> {
    // Lock before checking availability; another connection cannot claim the same agent.
    this.database.exec("BEGIN IMMEDIATE")

    try {
      const ticket = this.tickets.get(assignment.ticketId)
      const agent = this.agents.get(assignment.agentId)

      if (!ticket) {
        throw new Error(`Ticket ${assignment.ticketId} does not exist`)
      }
      if (!agent) {
        throw new Error(`Agent ${assignment.agentId} does not exist`)
      }
      if (ticket.status !== "Ready" && ticket.status !== "Retry") {
        throw new Error(`Ticket ${ticket.id} is not ready`)
      }
      if (this.assignments.listByTicketId(ticket.id).some((existing) => existing.completedAt === null)) {
        throw new Error(`Ticket ${ticket.id} already has an active assignment`)
      }
      if (agent.status !== "idle"
        || this.assignments.listByAgentId(agent.id).some((existing) => existing.completedAt === null)) {
        throw new Error(`Agent ${agent.id} is not available`)
      }

      const savedAssignment = this.assignments.create({
        ticketId: ticket.id,
        agentId: agent.id,
        status: assignment.assignmentStatus,
        assignedAt: assignment.assignedAt,
      })
      const savedTicket = this.tickets.update(ticket.id, { ...ticket, status: assignment.ticketStatus })

      if (!savedTicket) {
        throw new Error("Ticket disappeared while creating the assignment")
      }

      this.database.exec("COMMIT")
      return savedAssignment
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }
  }

  // Ready and Retry tickets are both schedulable; their stored statuses stay unchanged.
  async getReadyTickets(): Promise<SchedulerTicket[]> {
    const tickets = this.tickets.list()

    return tickets.filter((ticket) => ticket.status === "Ready" || ticket.status === "Retry")
  }
}
