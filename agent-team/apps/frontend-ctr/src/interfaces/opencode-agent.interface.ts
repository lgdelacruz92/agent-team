// Contract for an opencode agent (for example the frontend worker) that the Controller hands tickets to.

// A running conversation with an agent. One session works on one ticket.
export interface OpencodeSessionInterface {
  id: string
}

// One message in a session, in plain text.
export interface OpencodeMessageInterface {
  id: string

  // Who wrote it: the controller ("user") or the agent ("assistant").
  role: "user" | "assistant"
  text: string
}

// What an agent is doing right now.
export type OpencodeAgentState = "idle" | "busy" | "unreachable"

// An opencode agent the Controller can start work on, watch and stop.
// The Controller receives a list of these, so it never depends on a concrete agent.
export interface OpencodeAgentInterface {
  // Unique name, such as "frontend" or "backend". Used to pick the agent for a ticket.
  readonly name: string

  // Reports whether the agent can take work now.
  state(): Promise<OpencodeAgentState>

  // Opens a new session for one ticket.
  createSession(title: string): Promise<OpencodeSessionInterface>

  // Sends a prompt to a session without waiting for the agent to finish.
  prompt(sessionId: string, text: string): Promise<void>

  // Resolves when the session stops working, or false if it is still working after timeoutMs.
  waitForIdle(sessionId: string, timeoutMs: number): Promise<boolean>

  // Stops the turn in progress. The session keeps its context so it can be prompted again, for the wrap-up.
  abort(sessionId: string): Promise<void>

  // Messages of a session, oldest first.
  messages(sessionId: string): Promise<OpencodeMessageInterface[]>

  // Deletes every session of the agent, so finished tickets do not pile up.
  clearSessions(): Promise<void>
}
