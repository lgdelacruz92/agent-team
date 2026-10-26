import { tool } from "@opencode-ai/plugin"

// The workers are opencode servers on the shared docker network. Sending a message starts a session on the
// worker and waits for its report.
const WORKERS: Record<string, string> = {
  frontend: process.env.FRONTEND_URL ?? "http://opencode-frontend:4096",
  backend: process.env.BACKEND_URL ?? "http://opencode-backend:4096",
  "aws-solutions-architect": process.env.AWS_ARCHITECT_URL ?? "http://opencode-aws-architect:4096",
}
const TIMEOUT_MS = Number(process.env.ASSIGN_TIMEOUT_MS ?? 30 * 60 * 1000)

async function call(base: string, path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`POST ${path} returned ${res.status}: ${await res.text()}`)
  return res.json()
}

export default tool({
  description:
    "Hand a task to a worker and wait for its report. The worker is frontend, backend or aws-solutions-architect. " +
    "Put everything the worker needs in the task text; it cannot see Vikunja.",
  args: {
    worker: tool.schema.enum(["frontend", "backend", "aws-solutions-architect"]).describe("Who does the work"),
    task: tool.schema.string().describe("Full task text: description, acceptance criteria, API contract, report format"),
  },
  async execute({ worker, task }) {
    const base = WORKERS[worker].replace(/\/$/, "")
    try {
      const session = await call(base, "/session", { title: task.split("\n")[0].slice(0, 80) })
      const reply = await call(base, `/session/${session.id}/message`, { parts: [{ type: "text", text: task }] })
      const text = (reply.parts ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
      return text || "The worker finished without a written report."
    } catch (err) {
      return `Assigning to ${worker} failed: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})
