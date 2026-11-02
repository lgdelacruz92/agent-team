// Client for one opencode agent server. Not implemented yet: every method is a stub.
import type {
  OpencodeAgentInterface,
  OpencodeAgentState,
  OpencodeMessageInterface,
  OpencodeSessionInterface,
} from "../interfaces/opencode-agent.interface.js"

// An opencode agent the Controller can hand tickets to, identified by its name.
export class OpencodeAgent implements OpencodeAgentInterface {
  constructor(readonly name: string) {}

  // Reports whether the agent can take work now.
  state(): Promise<OpencodeAgentState> {
    throw new Error("Method not implemented.")
  }

  // Opens a new session for one ticket.
  createSession(_title: string): Promise<OpencodeSessionInterface> {
    throw new Error("Method not implemented.")
  }

  // Sends a prompt to a session without waiting for the agent to finish.
  prompt(_sessionId: string, _text: string): Promise<void> {
    throw new Error("Method not implemented.")
  }

  // Resolves when the session stops working, or false if it is still working after timeoutMs.
  waitForIdle(_sessionId: string, _timeoutMs: number): Promise<boolean> {
    throw new Error("Method not implemented.")
  }

  // Stops the turn in progress; the session keeps its context.
  abort(_sessionId: string): Promise<void> {
    throw new Error("Method not implemented.")
  }

  // Messages of a session, oldest first.
  messages(_sessionId: string): Promise<OpencodeMessageInterface[]> {
    throw new Error("Method not implemented.")
  }
}
