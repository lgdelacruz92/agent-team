// Client for one opencode agent server. state(), createSession() and clearSessions() are implemented; the other methods are still stubs.
import { config } from "../config.js"
import type {
  OpencodeAgentInterface,
  OpencodeAgentState,
  OpencodeMessageInterface,
  OpencodeSessionInterface,
} from "../interfaces/opencode-agent.interface.js"

// The part of a session record from GET /api/session that state() reads. Times are epoch milliseconds.
interface OpencodeSessionRecord {
  time: { busy?: number; idle?: number }
}

// An opencode agent the Controller can hand tickets to, identified by its name.
export class OpencodeAgent implements OpencodeAgentInterface {
  // The server defaults to the configured opencode worker; tests can point it elsewhere.
  constructor(
    readonly name: string,
    private readonly baseUrl: string = config.opencodeUrl,
  ) {}

  // Basic auth header for the opencode server. Empty when no password is configured.
  private headers(): Record<string, string> {
    if (!config.opencodePassword) {
      return {}
    }

    const credentials = Buffer.from(`${config.opencodeUser}:${config.opencodePassword}`).toString("base64")

    return { Authorization: `Basic ${credentials}` }
  }

  // Reports whether the agent can take work now.
  // "unreachable" when the server does not answer; "busy" when any session is working; otherwise "idle".
  // opencode v2 has no /session/status route, so this reads GET /api/session (newest sessions first).
  async state(): Promise<OpencodeAgentState> {
    let sessions: OpencodeSessionRecord[]

    try {
      const res = await fetch(`${this.baseUrl}/api/session`, {
        headers: this.headers(),
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

  // Opens a new session for one ticket.
  // Posts to POST /api/session and returns the id the server assigned. Throws when the server does not answer.
  async createSession(title: string): Promise<OpencodeSessionInterface> {
    const res = await fetch(`${this.baseUrl}/api/session`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
      signal: AbortSignal.timeout(config.opencodeTimeoutMs),
    })

    if (!res.ok) {
      throw new Error(`opencode ${this.name} POST /api/session returned ${res.status}`)
    }

    const body = (await res.json()) as { data: { id: string } }

    return { id: body.data.id }
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

  // Lists the ids of the sessions on the first page of GET /api/session. Throws when the server does not answer.
  private async listSessionIds(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/session`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(config.opencodeTimeoutMs),
    })

    if (!res.ok) {
      throw new Error(`opencode ${this.name} GET /api/session returned ${res.status}`)
    }

    const body = (await res.json()) as { data: { id: string }[] }

    return body.data.map((session) => session.id)
  }

  // Deletes every session of the agent.
  // The list is paged, so it deletes the page it got and lists again until nothing is left.
  async clearSessions(): Promise<void> {
    let ids = await this.listSessionIds()

    while (ids.length > 0) {
      for (const id of ids) {
        const res = await fetch(`${this.baseUrl}/api/session/${id}`, {
          method: "DELETE",
          headers: this.headers(),
          signal: AbortSignal.timeout(config.opencodeTimeoutMs),
        })

        // A session that is already gone is what we wanted; any other failure stops the loop so it cannot spin.
        if (!res.ok && res.status !== 404) {
          throw new Error(`opencode ${this.name} DELETE /api/session/${id} returned ${res.status}`)
        }
      }

      ids = await this.listSessionIds()
    }
  }
}
