// Observes one OpenCode server; other agent operations are not implemented yet.
import type { OpencodeAgentInterface, OpencodeState } from "../interfaces/opencode-agent.interface.js"

// The frontend controller uses the same request timeout for OpenCode calls.
const defaultTimeoutMs = 30_000

// A plain object is needed before reading fields from an untrusted server response.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Reports the server's overall availability, independent of a particular assignment.
export class OpencodeAgent implements OpencodeAgentInterface {
  constructor(
    readonly url: string,
    private readonly headers: Record<string, string> = {},
    private readonly timeoutMs: number = defaultTimeoutMs,
  ) {}

  // A session is busy when its most recent busy time is newer than its idle time.
  // Check every page: an older session can still be running.
  async state(): Promise<OpencodeState> {
    const signal = AbortSignal.timeout(this.timeoutMs)
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    let endpoint: URL

    try {
      endpoint = new URL(`${this.url.replace(/\/+$/, "")}/api/session`)
    } catch {
      return "unknown"
    }

    while (true) {
      if (cursor !== undefined) {
        endpoint.searchParams.set("cursor", cursor)
      }

      let response: Response
      try {
        response = await fetch(endpoint, { headers: this.headers, signal })
      } catch {
        return "unreachable"
      }

      // An HTTP error means the server answered, but its state is not known.
      if (!response.ok) {
        return "unknown"
      }

      let body: unknown
      try {
        body = await response.json()
      } catch {
        if (signal.aborted) {
          return "unreachable"
        }
        return "unknown"
      }

      if (!isRecord(body) || !Array.isArray(body.data) || !isRecord(body.cursor)) {
        return "unknown"
      }

      for (const session of body.data) {
        if (!isRecord(session) || typeof session.id !== "string" || !isRecord(session.time)) {
          return "unknown"
        }

        const { busy, idle } = session.time
        if ((busy !== undefined && (typeof busy !== "number" || !Number.isFinite(busy)))
          || (idle !== undefined && (typeof idle !== "number" || !Number.isFinite(idle)))) {
          return "unknown"
        }

        if (typeof busy === "number" && (idle === undefined || (typeof idle === "number" && idle < busy))) {
          return "busy"
        }
      }

      const next = body.cursor.next
      if (next === undefined || next === null) {
        return "idle"
      }
      if (typeof next !== "string" || next.length === 0 || seenCursors.has(next)) {
        return "unknown"
      }

      seenCursors.add(next)
      cursor = next
    }
  }

  async createSession(_title: string): Promise<string> {
    throw new Error("OpencodeAgent.createSession is not implemented")
  }

  async prompt(_sessionId: string, _text: string): Promise<void> {
    throw new Error("OpencodeAgent.prompt is not implemented")
  }

  async sessionState(_sessionId: string): Promise<OpencodeState> {
    throw new Error("OpencodeAgent.sessionState is not implemented")
  }

  async abort(_sessionId: string): Promise<void> {
    throw new Error("OpencodeAgent.abort is not implemented")
  }
}
