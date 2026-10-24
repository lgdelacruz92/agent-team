import { tool } from "@opencode-ai/plugin"

// Each worker is its own OpenCode server (see docker-compose.yaml), so the
// built-in task tool cannot reach it. This tool drives the worker's HTTP API.
const WORKERS: Record<string, string> = {
  backend: process.env.BACKEND_URL ?? "http://opencode-backend:4096",
  frontend: process.env.FRONTEND_URL ?? "http://opencode-frontend:4096",
  "aws-solutions-architect": process.env.AWS_ARCHITECT_URL ?? "http://opencode-aws-architect:4096",
}

const USERNAME = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
const PASSWORD = process.env.OPENCODE_SERVER_PASSWORD ?? ""
const TIMEOUT_MS = Number(process.env.DELEGATE_TIMEOUT_MS ?? 9 * 60 * 1000)

const headers = {
  "Content-Type": "application/json",
  Authorization: "Basic " + Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64"),
}

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${init.method} ${url} returned ${res.status}: ${await res.text()}`)
  return res.json()
}

export default tool({
  description:
    "Send a task to the frontend, backend or aws-solutions-architect worker agent and wait for its report. " +
    "The worker does not see this conversation, so the prompt must be self-contained. " +
    "Call it several times in one turn to run independent tasks in parallel. " +
    "Pass the returned sessionId back to follow up with the same worker.",
  args: {
    agent: tool.schema.enum(["backend", "frontend", "aws-solutions-architect"]).describe("Worker that should do the task"),
    prompt: tool.schema.string().describe("Complete task: ID, description, acceptance criteria, API contract, time left, report format"),
    sessionId: tool.schema.string().optional().describe("Continue an earlier session with this worker instead of starting a new one"),
  },
  async execute({ agent, prompt, sessionId }) {
    const base = WORKERS[agent]
    try {
      const id = sessionId ?? (await call(`${base}/session`, { method: "POST", body: JSON.stringify({ title: prompt.slice(0, 60) }) })).id
      // Blocks until the worker finishes its turn.
      const message = await call(`${base}/session/${id}/message`, {
        method: "POST",
        body: JSON.stringify({ agent, parts: [{ type: "text", text: prompt }] }),
      })
      const report = (message.parts ?? [])
        .filter((part: { type: string }) => part.type === "text")
        .map((part: { text: string }) => part.text)
        .join("\n")
      const error = message.info?.error ? `\nWorker error: ${JSON.stringify(message.info.error)}` : ""
      return `sessionId: ${id}\n\n${report || "(worker returned no text)"}${error}`
    } catch (err) {
      return `Delegation to ${agent} failed: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})
