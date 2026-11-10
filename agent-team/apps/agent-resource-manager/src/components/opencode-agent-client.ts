// Starts and observes sessions on one OpenCode server.
import type { OpencodeAgentClientInterface, OpencodeSessionActivity, OpencodeSessionState, OpencodeState } from "../interfaces/opencode-agent-client.interface.js"

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

  // Active sessions reflect the current process, not stale persisted timestamps.
  async state(): Promise<OpencodeState> {
    const active = await this._activeSessions()
    return active.state === "ok" ? (active.ids.size > 0 ? "busy" : "idle") : active.state
  }

  private async _activeSessions(): Promise<{ state: "ok"; ids: Set<string> } | { state: "unknown" | "unreachable" }> {
    const signal = AbortSignal.timeout(this.timeoutMs)
    let endpoint: URL

    try {
      endpoint = new URL(`${this.url.replace(/\/+$/, "")}/api/session/active`)
    } catch {
      return { state: "unknown" }
    }

    let response: Response
    try {
      response = await fetch(endpoint, { headers: this.headers, signal })
    } catch {
      return { state: "unreachable" }
    }
    if (!response.ok) return { state: "unknown" }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { state: signal.aborted ? "unreachable" : "unknown" }
    }
    if (!isRecord(body) || !isRecord(body.data)) return { state: "unknown" }

    const ids = new Set<string>()
    for (const [id, activity] of Object.entries(body.data)) {
      if (!id.startsWith("ses") || !isRecord(activity) || activity.type !== "running") return { state: "unknown" }
      ids.add(id)
    }
    return { state: "ok", ids }
  }

  private async _call(path: string, body?: unknown): Promise<Response> {
    const response = await fetch(`${this.url.replace(/\/+$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...this.headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    return response
  }

  private async _post(path: string, body: unknown): Promise<Response> {
    const response = await this._call(path, body)
    if (!response.ok) throw new Error(`OpenCode POST ${path} returned HTTP ${response.status}`)
    return response
  }

  private _sessionPath(sessionId: string): string {
    if (!sessionId) throw new Error("OpenCode session ID is required")
    return `/api/session/${encodeURIComponent(sessionId)}`
  }

  async createSession(title: string): Promise<string> {
    const body: unknown = await (await this._post("/api/session", { title })).json()
    if (!isRecord(body) || !isRecord(body.data) || typeof body.data.id !== "string" || !body.data.id) {
      throw new Error("OpenCode returned an invalid session ID")
    }
    return body.data.id
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    await this._post(`${this._sessionPath(sessionId)}/prompt`, { text })
  }

  async sessionState(sessionId: string): Promise<OpencodeSessionState> {
    return (await this.sessionActivity(sessionId)).state
  }

  async sessionActivity(sessionId: string): Promise<OpencodeSessionActivity> {
    const withoutTimes = (state: OpencodeSessionState): OpencodeSessionActivity => ({ state, busyAt: null, idleAt: null })
    let response: Response
    try {
      response = await this._call(this._sessionPath(sessionId))
    } catch {
      return withoutTimes("unreachable")
    }
    if (response.status === 404) return withoutTimes("missing")
    if (!response.ok) return withoutTimes("unknown")
    try {
      const body: unknown = await response.json()
      if (!isRecord(body) || !isRecord(body.data) || body.data.id !== sessionId || !isRecord(body.data.time)) return withoutTimes("unknown")
      const { busy, idle } = body.data.time
      if ((busy !== undefined && (typeof busy !== "number" || !Number.isFinite(busy)))
        || (idle !== undefined && (typeof idle !== "number" || !Number.isFinite(idle)))) return withoutTimes("unknown")
      const busyAt = typeof busy === "number" ? busy : null
      const idleAt = typeof idle === "number" ? idle : null
      const active = await this._activeSessions()
      const state = active.state === "ok" ? (active.ids.has(sessionId) ? "busy" : "idle") : active.state
      return { state, busyAt, idleAt }
    } catch {
      return withoutTimes("unknown")
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this._post(`${this._sessionPath(sessionId)}/interrupt`, {})
  }
}
