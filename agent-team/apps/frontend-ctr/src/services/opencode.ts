// REST client for the frontend worker's opencode server (the v2 API the bridge uses).
import { config } from "../config.js"
import type { Message, SessionState } from "../interfaces/opencode.js"

const auth = "Basic " + Buffer.from(`${config.opencodeUser}:${config.opencodePassword}`).toString("base64")

// An HTTP failure from opencode, with its status code (404 means the session is gone).
export class OpencodeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

// Sends one request to the opencode server and returns the parsed JSON (null for 204).
async function oc(method: string, path: string, body?: unknown): Promise<any> {
  let payload: string | undefined
  if (body !== undefined) {
    payload = JSON.stringify(body)
  }

  const res = await fetch(`${config.opencodeUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: payload,
    signal: AbortSignal.timeout(config.opencodeTimeoutMs),
  })

  if (!res.ok) {
    throw new OpencodeError(`opencode ${method} ${path} returned ${res.status}: ${await res.text()}`, res.status)
  }

  if (res.status === 204) {
    return null
  }

  return res.json()
}

// Creates a session for the worker agent and returns its id.
export async function createSession(title: string): Promise<string> {
  const created = await oc("POST", "/api/session", { title: title.slice(0, 60), agent: config.worker })

  return created.data.id
}

// Queues a prompt and returns its message id. Does not wait for the worker.
export async function sendPrompt(session: string, text: string): Promise<string> {
  const queued = await oc("POST", `/api/session/${session}/prompt`, { text })

  return queued.data.id
}

// Messages of a session, newest first.
export async function messages(session: string): Promise<Message[]> {
  const listed = await oc("GET", `/api/session/${session}/message`)

  return listed.data
}

// Assumption to verify (proposal section 10): this route aborts the running turn and leaves the session usable.
export async function abort(session: string): Promise<void> {
  await oc("POST", `/api/session/${session}/abort`, {})
}

// Inspects the session without blocking, looking only at messages after `since`.
// Throws OpencodeError with status 404 when the session is gone.
export async function inspect(session: string, since: string): Promise<SessionState> {
  const all = await messages(session)
  const ours = all.filter((message) => !since || message.id > since)

  const idle = ours.find((message) => message.type === "idle")
  const reply = ours.find((message) => message.type === "assistant" && message.content?.some((part) => part.type === "text"))

  const report = (reply?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()

  let error: string | null = null
  if (idle?.error) {
    error = idle.error.message ?? JSON.stringify(idle.error)
  }

  return { idle: !!idle, report, error }
}
