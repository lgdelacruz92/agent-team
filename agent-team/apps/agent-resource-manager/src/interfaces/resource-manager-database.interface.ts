// Defines the Resource Manager's view of the shared database.

// A Ticket Scheduler assignment reserves its ticket and agent while completedAt is null.
export interface Assignment {
  id: number
  ticketId: number
  agentId: number
  status: string
  assignedAt: string
  completedAt: string | null
}

// The local ticket ID is distinct from the ID used to fetch the task from Vikunja.
export interface Ticket {
  id: number
  vikunjaTaskId: number
  title: string
  status: string
  priority: number
  presentOnBoard: boolean
}

// The URL identifies the OpenCode server; existing databases may need a schema update.
export interface Agent {
  id: number
  name: string
  status: string
  url: string | null
}

export type ExecutionStatus = "starting" | "running" | "succeeded" | "failed"

export interface Execution {
  id: number
  assignmentId: number
  sessionId: string | null
  status: ExecutionStatus
  createdAt: string
  workRequestedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  failureReason: string | null
}

// Reads reservations and reports Resource Manager-owned assignment and agent state.
export interface ResourceManagerDatabaseInterface {
  // Read all agents for the per-tick status check.
  listAgents(): Promise<Agent[]>

  // Read assignments that still reserve their ticket and agent.
  listIncompleteAssignments(): Promise<Assignment[]>

  getAssignment(assignmentId: number): Promise<Assignment | null>

  // Find the local ticket associated with an assignment, or null if it is missing.
  getTicket(ticketId: number): Promise<Ticket | null>

  // Record progress or an outcome without releasing the assignment reservation.
  updateAssignmentStatus(assignmentId: number, status: string): Promise<void>

  // Release the reservation after the agreed completion coordination is satisfied.
  // The agreed shared-lock and completion protocol is not implemented yet.
  completeAssignment(assignmentId: number, completedAt: string): Promise<void>

  // Report agent availability or flag an agent for human review.
  updateAgentStatus(agentId: number, status: string): Promise<void>

  getLatestExecution(assignmentId: number): Promise<Execution | null>
  createExecution(assignmentId: number, createdAt: string): Promise<Execution>
  saveSession(executionId: number, sessionId: string): Promise<void>
  recordWorkRequest(executionId: number, requestedAt: string): Promise<void>
  markRunning(executionId: number, startedAt: string): Promise<void>
  finishExecution(executionId: number, status: "succeeded" | "failed", finishedAt: string, reason: string | null): Promise<void>
}
