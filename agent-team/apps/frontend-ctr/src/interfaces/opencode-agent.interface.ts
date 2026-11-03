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

  // True when the session is idle and the agent has answered the prompt, so its reply is ready to post.
  isDone(sessionId: string): Promise<boolean>

  // True when the run has used up its time budget, counted from startedAt (epoch milliseconds),
  // whatever the agent is doing. startedAt comes from the ticket, so the agent holds no clock of its own.
  isStale(sessionId: string, startedAt: number): Promise<boolean>

  // True when the session produced something recently, judged from the time of its newest message.
  // Only meaningful while the agent is busy: a busy session that is not progressing is stuck.
  isProgressing(sessionId: string): Promise<boolean>

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

  // Deletes one session the agent tracks, by id, and stops tracking it.
  deleteSession(sessionId: string): Promise<void>

  // Deletes every session of the agent, so finished tickets do not pile up.
  clearSessions(): Promise<void>
}
