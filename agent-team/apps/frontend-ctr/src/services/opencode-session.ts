// Client for one session of an opencode agent server: prompt it, wait for it, stop it, read it and delete it.
import { opencodeHeaders } from "../components/opencode-headers.js"
import { config } from "../config.js"
import type { OpencodeMessageInterface } from "../interfaces/opencode-agent.interface.js"
import type { OpencodeSessionHandleInterface } from "../interfaces/opencode-session.interface.js"

// The parts of a message from GET /api/session/:id/message that messages() reads.
interface OpencodeMessageRecord {
  id: string
  type: string

  // User messages carry their text directly.
  text?: string

  // Assistant messages carry a list of parts (text, reasoning, tool).
  content?: { type: string; text?: string }[]
}

// One page of messages. cursor.next is null or missing on the last page.
interface OpencodeMessagePage {
  data: OpencodeMessageRecord[]
  cursor?: { next?: string | null }
}

// A session the Controller drives while it works on one ticket.
export class OpencodeSession implements OpencodeSessionHandleInterface {
  // Id the server assigned. Empty until init() is called.
  id = ""

  // The server defaults to the configured opencode worker; init() can point it elsewhere.
  private baseUrl: string = config.opencodeUrl

  // Opens the session on the server (POST /api/session) and binds this object to the id it assigned.
  // Returns the session so it can be created and opened in one expression. Throws when the server does not answer.
  async init(title: string, baseUrl: string = config.opencodeUrl): Promise<this> {
    this.baseUrl = baseUrl

    const res = await this.call("POST", "/api/session", { body: { title } })
    const body = (await res.json()) as { data: { id: string } }

    this.id = body.data.id

    return this
  }

  // Id for building routes. Throws before init(), so a session that was never opened cannot call /api/session/.
  private get boundId(): string {
    if (!this.id) {
      throw new Error("opencode session is not open; call init() first")
    }

    return this.id
  }

  // Path of this session's routes, before any suffix.
  private get route(): string {
    return `/api/session/${this.boundId}`
  }

  // Sends one request and throws on any failure status. `path` is relative to the server root.
  // Extra status codes in `allow` are treated as success (for example 404 when deleting).
  private async call(
    method: string,
    path: string,
    options: { body?: unknown; signal?: AbortSignal; allow?: number[] } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = opencodeHeaders()

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json"
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: JSON.stringify(options.body),
      signal: options.signal ?? AbortSignal.timeout(config.opencodeTimeoutMs),
    })

    if (!res.ok && !options.allow?.includes(res.status)) {
      throw new Error(`opencode ${method} ${path} returned ${res.status}`)
    }

    return res
  }

  // Queues the prompt; the server answers at once and the agent works in the background.
  async prompt(text: string): Promise<void> {
    await this.call("POST", `${this.route}/prompt`, { body: { text } })
  }

  // The wait route holds the request open until the session is idle and has no timeout of its own,
  // so the request itself is cut off after timeoutMs and that means "still working".
  async waitForIdle(timeoutMs: number): Promise<boolean> {
    try {
      // This route is still under /api/experimental in opencode v2.
      await this.call("POST", `/api/experimental/session/${this.boundId}/wait`, { signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        return false
      }

      throw err
    }

    return true
  }

  // Interrupts the running turn. Without resume=true the session just stops and keeps its context.
  async abort(): Promise<void> {
    await this.call("POST", `${this.route}/interrupt`)
  }

  // Reads every page of messages, oldest first, and keeps the user and assistant ones that have text.
  async messages(): Promise<OpencodeMessageInterface[]> {
    const messages: OpencodeMessageInterface[] = []
    const seen = new Set<string>()
    let path = `${this.route}/message?order=asc`

    // Follow the cursor until the last page. A repeated cursor would loop forever, so it also ends the loop.
    while (true) {
      const page = (await (await this.call("GET", path)).json()) as OpencodeMessagePage

      for (const record of page.data) {
        const message = toMessage(record)

        if (message) {
          messages.push(message)
        }
      }

      const next = page.cursor?.next

      if (!next || seen.has(next)) {
        return messages
      }

      seen.add(next)
      path = `${this.route}/message?cursor=${encodeURIComponent(next)}`
    }
  }

  // Deletes the session. One that is already gone is what we wanted.
  async delete(): Promise<void> {
    await this.call("DELETE", this.route, { allow: [404] })
  }
}

// Converts a server message to plain text, or null for messages that are not a conversation turn
// (idle markers, model switches, tool-only assistant steps).
const toMessage = (record: OpencodeMessageRecord): OpencodeMessageInterface | null => {
  if (record.type === "user" && record.text) {
    return { id: record.id, role: "user", text: record.text }
  }

  if (record.type === "assistant") {
    const text = (record.content ?? [])
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n")

    if (text) {
      return { id: record.id, role: "assistant", text }
    }
  }

  return null
}
