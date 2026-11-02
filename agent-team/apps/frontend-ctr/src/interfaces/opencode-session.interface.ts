// Contract for one session of an opencode agent: the operations that act on a single ticket's conversation.
import type { OpencodeMessageInterface } from "./opencode-agent.interface.js"

// A live session the Controller drives while it works on one ticket.
// It binds the session id, so callers do not pass the id on every call.
export interface OpencodeSessionHandleInterface {
  // Id the server assigned when the session was created.
  readonly id: string

  // Sends a prompt without waiting for the agent to finish.
  prompt(text: string): Promise<void>

  // Resolves true when the session stops working, or false if it is still working after timeoutMs.
  waitForIdle(timeoutMs: number): Promise<boolean>

  // Stops the turn in progress. The session keeps its context so it can be prompted again, for the wrap-up.
  abort(): Promise<void>

  // Messages of the session, oldest first.
  messages(): Promise<OpencodeMessageInterface[]>

  // Deletes the session, so a finished ticket does not pile up.
  delete(): Promise<void>
}
