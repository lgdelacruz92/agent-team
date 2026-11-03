// Client for one opencode agent server. It tracks its sessions and hands prompt, wait, abort and messages to them.
import { opencodeHeaders } from "../components/opencode-headers.js"
import { config } from "../config.js"
import type {
  OpencodeAgentInterface,
  OpencodeAgentState,
  OpencodeMessageInterface,
  OpencodeSessionInterface,
} from "../interfaces/opencode-agent.interface.js"
import type { OpencodeSessionHandleInterface } from "../interfaces/opencode-session.interface.js"
import { OpencodeSession } from "./opencode-session.js"

// The part of a session record from GET /api/session that state() reads. Times are epoch milliseconds.
interface OpencodeSessionRecord {
  id: string
  time: { busy?: number; idle?: number }
}

// Milliseconds in a minute, to turn the configured run budget into the same unit as Date.now().
const msPerMinute = 60_000

// How long isDone() waits for the session to go idle. Short, so one slow session cannot hold up a tick.
const idleCheckMs = 1000

// An opencode agent the Controller can hand tickets to, identified by its name.
export class OpencodeAgent implements OpencodeAgentInterface {
  // The sessions this agent is working on, found by id for prompt, wait, abort and messages.
  private readonly sessions: OpencodeSessionHandleInterface[]

  // `sessions` are the ones to start with, for example sessions that survived a restart; a copy is kept so
  // the caller's array is not changed when createSession() adds to it.
  // The server defaults to the configured opencode worker; tests can point it elsewhere.
  constructor(
    readonly name: string,
    sessions: OpencodeSessionHandleInterface[] = [],
    private readonly baseUrl: string = config.opencodeUrl,
  ) {
    this.sessions = [...sessions]
  }

  // Finds a tracked session by id. Throws for an id this agent does not know, so a typo cannot go unnoticed.
  private session(sessionId: string): OpencodeSessionHandleInterface {
    const found = this.sessions.find((session) => session.id === sessionId)

    if (!found) {
      throw new Error(`opencode ${this.name} has no session ${sessionId}`)
    }

    return found
  }

  // Reports whether the agent can take work now.
  // "unreachable" when the server does not answer; "busy" when any session is working; otherwise "idle".
  // opencode v2 has no /session/status route, so this reads GET /api/session (newest sessions first).
  async state(): Promise<OpencodeAgentState> {
    let sessions: OpencodeSessionRecord[]

    try {
      const res = await fetch(`${this.baseUrl}/api/session`, {
        headers: opencodeHeaders(),
        signal: AbortSignal.timeout(config.opencodeTimeoutMs),
      })

      if (!res.ok) {
        return "unreachable"
      }

      sessions = ((await res.json()) as { data: OpencodeSessionRecord[] }).data
    } catch {
      return "unreachable"
    }

    // A session is working when it went busy and has not gone idle since.
    for (const session of sessions) {
      const { busy, idle } = session.time

      if (busy !== undefined && (idle === undefined || idle < busy)) {
        return "busy"
      }
    }

    return "idle"
  }

  // Done when the session is idle and the last message is the agent's reply, so there is a reply to post.
  // A session that was just prompted is idle for a moment with the user's prompt as its last message: not done yet.
  async isDone(sessionId: string): Promise<boolean> {
    const idle = await this.waitForIdle(sessionId, idleCheckMs)

    if (!idle) {
      return false
    }

    const messages = await this.messages(sessionId)
    const last = messages[messages.length - 1]

    if (!last) {
      return false
    }

    return last.role === "assistant"
  }

  // Stale when the run has used up its budget, whatever the agent is doing. The clock starts at startedAt,
  // which the Controller stored on the ticket, so this agent keeps no clock of its own.
  async isStale(_sessionId: string, startedAt: number): Promise<boolean> {
    return Date.now() - startedAt > config.maxRunMin * msPerMinute
  }

  // Placeholder until messages carry a timestamp: always progressing, so a stuck session is caught by isStale()
  // at the end of its budget instead. Replace with "newest message is younger than the threshold".
  async isProgressing(_sessionId: string): Promise<boolean> {
    return true
  }

  // Opens a new session for one ticket.
  // The session posts to POST /api/session and returns the id the server assigned. Throws when the server does not answer.
  async createSession(title: string): Promise<OpencodeSessionInterface> {
    // Track the session so the other methods can reach it by id.
    const session = await new OpencodeSession().init(title, this.baseUrl)

    this.sessions.push(session)

    return { id: session.id }
  }

  // Sends a prompt to a session without waiting for the agent to finish.
  prompt(sessionId: string, text: string): Promise<void> {
    return this.session(sessionId).prompt(text)
  }

  // Resolves when the session stops working, or false if it is still working after timeoutMs.
  waitForIdle(sessionId: string, timeoutMs: number): Promise<boolean> {
    return this.session(sessionId).waitForIdle(timeoutMs)
  }

  // Stops the turn in progress; the session keeps its context.
  abort(sessionId: string): Promise<void> {
    return this.session(sessionId).abort()
  }

  // Messages of a session, oldest first.
  messages(sessionId: string): Promise<OpencodeMessageInterface[]> {
    return this.session(sessionId).messages()
  }

  // Deletes one tracked session by id, then stops tracking it.
  // Throws for an id this agent does not know. A failed delete throws and leaves the session tracked.
  async deleteSession(sessionId: string): Promise<void> {
    await this.session(sessionId).delete()

    this.sessions.splice(
      this.sessions.findIndex((session) => session.id === sessionId),
      1,
    )
  }

  // Lists the ids of the sessions this agent tracks.
  private listSessionIds(): string[] {
    return this.sessions.map((session) => session.id)
  }

  // Deletes every session this agent tracks, and stops tracking each one as soon as it is deleted.
  // Sessions the agent was never given (for example ones left on the server by an earlier run) are not touched.
  // A failed delete throws and leaves that session and the ones after it tracked, so a retry picks up where it stopped.
  async clearSessions(): Promise<void> {
    for (const id of this.listSessionIds()) {
      await this.session(id).delete()

      this.sessions.splice(
        this.sessions.findIndex((session) => session.id === id),
        1,
      )
    }
  }
}
