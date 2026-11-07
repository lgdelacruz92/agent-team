// Selects a local agent and records ownership; OpenCode session dispatch is separate.
import type { AgentStore } from "../db/agent-store.js"
import type { AssignmentStore } from "../db/assignment-store.js"
import type { AgentManagerInterface } from "../interfaces/agent-manager.interface.js"
import type { Assignment, SchedulerDatabaseInterface, SchedulerTicket } from "../interfaces/scheduler-database.interface.js"

export class AgentManager implements AgentManagerInterface {
  constructor(
    private readonly database: SchedulerDatabaseInterface,
    private readonly agents: AgentStore,
    private readonly assignments: AssignmentStore,
  ) {}

  async assignTicket(ticket: SchedulerTicket): Promise<Assignment | null> {
    // Reuse an existing claim if this method is called again for the same ticket.
    const existingAssignment = this.assignments.listByTicketId(ticket.id)
      .find((assignment) => assignment.completedAt === null)

    if (existingAssignment) {
      return existingAssignment
    }

    if (!ticket.presentOnBoard || (ticket.status !== "Ready" && ticket.status !== "Retry")) {
      throw new Error(`Ticket ${ticket.id} is not ready`)
    }

    const busyAgentIds = new Set(this.assignments.list()
      .filter((assignment) => assignment.completedAt === null)
      .map((assignment) => assignment.agentId))
    const agent = this.agents.list()
      .find((candidate) => candidate.status === "idle" && !busyAgentIds.has(candidate.id))

    if (!agent) {
      return null
    }

    return this.database.createAssignment({
      ticketId: ticket.id,
      agentId: agent.id,
      assignmentStatus: "assigned",
      assignedAt: new Date().toISOString(),
    })
  }
}
