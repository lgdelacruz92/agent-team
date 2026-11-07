// Defines the operations for one containerized OpenCode agent server.

// An unknown state is not evidence that an agent or session has finished.
export type OpencodeState = "idle" | "busy" | "unreachable" | "unknown"

// Starts work on an agent and observes or stops its sessions.
export interface OpencodeAgentInterface {
  // URL of the OpenCode server for this agent.
  readonly url: string

  // Observe whether the agent is ready, busy, unreachable, or unknown.
  state(): Promise<OpencodeState>

  // Create a session and return its ID for tracking.
  createSession(title: string): Promise<string>

  // Send work to a previously created session without waiting for completion.
  prompt(sessionId: string, text: string): Promise<void>

  // Observe the specific session; idle alone does not prove a new start succeeded.
  sessionState(sessionId: string): Promise<OpencodeState>

  // Request that a session stop; a successful request does not guarantee it stopped.
  abort(sessionId: string): Promise<void>
}
