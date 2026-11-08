// Starts and observes sessions on one OpenCode server.
import type { OpencodeAgentClientInterface, OpencodeSessionState, OpencodeState } from "../interfaces/opencode-agent-client.interface.js"

// The frontend controller uses the same request timeout for OpenCode calls.
const defaultTimeoutMs = 30_000

// A plain object is needed before reading fields from an untrusted server response.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Reports the server's overall availability, independent of a particular assignment.
export class OpencodeAgentClient implements OpencodeAgentClientInterface {
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

  private async call(path: string, body?: unknown): Promise<Response> {
    const response = await fetch(`${this.url.replace(/\/+$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...this.headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    return response
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const response = await this.call(path, body)
    if (!response.ok) throw new Error(`OpenCode POST ${path} returned HTTP ${response.status}`)
    return response
  }

  private sessionPath(sessionId: string): string {
    if (!sessionId) throw new Error("OpenCode session ID is required")
    return `/api/session/${encodeURIComponent(sessionId)}`
  }

  async createSession(title: string): Promise<string> {
    const body: unknown = await (await this.post("/api/session", { title })).json()
    if (!isRecord(body) || !isRecord(body.data) || typeof body.data.id !== "string" || !body.data.id) {
      throw new Error("OpenCode returned an invalid session ID")
    }
    return body.data.id
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    await this.post(`${this.sessionPath(sessionId)}/prompt`, { text })
  }

  async sessionState(sessionId: string): Promise<OpencodeSessionState> {
    let response: Response
    try {
      response = await this.call(this.sessionPath(sessionId))
    } catch {
      return "unreachable"
    }
    if (response.status === 404) return "missing"
    if (!response.ok) return "unknown"
    try {
      const body: unknown = await response.json()
      if (!isRecord(body) || !isRecord(body.data) || body.data.id !== sessionId || !isRecord(body.data.time)) return "unknown"
      const { busy, idle } = body.data.time
      if ((busy !== undefined && (typeof busy !== "number" || !Number.isFinite(busy)))
        || (idle !== undefined && (typeof idle !== "number" || !Number.isFinite(idle)))) return "unknown"
      return typeof busy === "number" && (idle === undefined || (typeof idle === "number" && idle < busy)) ? "busy" : "idle"
    } catch {
      return "unknown"
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.post(`${this.sessionPath(sessionId)}/interrupt`, {})
  }
}
