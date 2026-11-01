// REST client for the frontend worker's opencode server (the v2 API the bridge uses).
import { config } from "./config.js"

const auth = "Basic " + Buffer.from(`${config.opencodeUser}:${config.opencodePassword}`).toString("base64")

export class OpencodeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function oc(method: string, path: string, body?: unknown, timeoutMs = config.opencodeTimeoutMs): Promise<any> {
  const res = await fetch(`${config.opencodeUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new OpencodeError(`opencode ${method} ${path} returned ${res.status}: ${await res.text()}`, res.status)
  return res.status === 204 ? null : res.json()
}

export interface Message {
  id: string
  type: string
  content?: { type: string; text?: string }[]
  error?: { message?: string }
}

export const createSession = async (title: string): Promise<string> =>
  (await oc("POST", "/api/session", { title: title.slice(0, 60), agent: config.worker })).data.id

/** Queues a prompt and returns its message id. Does not wait for the worker. */
export const sendPrompt = async (session: string, text: string): Promise<string> =>
  (await oc("POST", `/api/session/${session}/prompt`, { text })).data.id

/** Messages of a session, newest first. */
export const messages = async (session: string): Promise<Message[]> => (await oc("GET", `/api/session/${session}/message`)).data

// Assumption to verify (proposal section 10): this route aborts the running turn and leaves the session usable.
export const abort = async (session: string): Promise<void> => {
  await oc("POST", `/api/session/${session}/abort`, {})
}

export interface SessionState {
  /** The run started by the prompt with id `since` has ended. */
  idle: boolean
  /** Text of the worker's last reply after `since`, if any. */
  report: string
  error: string | null
}

/** Inspects the session without blocking. Throws OpencodeError 404 when the session is gone. */
export async function inspect(session: string, since: string): Promise<SessionState> {
  const ours = (await messages(session)).filter((m) => !since || m.id > since)
  const idle = ours.find((m) => m.type === "idle")
  const reply = ours.find((m) => m.type === "assistant" && m.content?.some((p) => p.type === "text"))
  const report = (reply?.content ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim()
  return { idle: !!idle, report, error: idle?.error ? (idle.error.message ?? JSON.stringify(idle.error)) : null }
}
