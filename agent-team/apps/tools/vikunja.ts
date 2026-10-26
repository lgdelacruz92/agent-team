import { tool } from "@opencode-ai/plugin"

// Vikunja runs in the blackberry stack. Reach it through the SSM port forward on the host
// (./ssh-ec2.sh --forward vikunja); the container sees the host as host.docker.internal.
const BASE_URL = (process.env.VIKUNJA_URL ?? "http://host.docker.internal:3456").replace(/\/$/, "")
const TOKEN = process.env.VIKUNJA_API_TOKEN ?? ""
const TIMEOUT_MS = Number(process.env.VIKUNJA_TIMEOUT_MS ?? 30 * 1000)

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}: ${await res.text()}`)
  return res.json()
}

const brief = (t: any) => ({
  id: t.id,
  title: t.title,
  description: t.description,
  done: t.done,
  due_date: t.due_date?.startsWith("0001") ? null : t.due_date,
  priority: t.priority,
  project_id: t.project_id,
})

export default tool({
  description:
    "Track work in Vikunja. Actions: list_projects; list_tasks (optional projectId, optional filter such as 'done = false'); " +
    "create_task (needs projectId and title); update_task (needs taskId, change any of title, description, dueDate, priority); " +
    "complete_task and reopen_task (need taskId). There is no delete.",
  args: {
    action: tool.schema
      .enum(["list_projects", "list_tasks", "create_task", "update_task", "complete_task", "reopen_task"])
      .describe("What to do"),
    projectId: tool.schema.number().optional().describe("Vikunja project ID (create_task, list_tasks)"),
    taskId: tool.schema.number().optional().describe("Vikunja task ID (update_task, complete_task, reopen_task)"),
    title: tool.schema.string().optional().describe("Task title"),
    description: tool.schema.string().optional().describe("Task description, e.g. the acceptance criteria and assigned team member"),
    dueDate: tool.schema.string().optional().describe("ISO 8601 date-time, e.g. 2026-11-01T17:00:00Z"),
    priority: tool.schema.number().int().min(0).max(5).optional().describe("0 unset, 1 low ... 5 do now"),
    filter: tool.schema.string().optional().describe("Vikunja filter for list_tasks, e.g. 'done = false'"),
  },
  async execute({ action, projectId, taskId, title, description, dueDate, priority, filter }) {
    if (!TOKEN) return "Vikunja failed: VIKUNJA_API_TOKEN is not set in the cto container."
    try {
      switch (action) {
        case "list_projects": {
          const projects = await call("GET", "/projects")
          return JSON.stringify(projects.map((p: any) => ({ id: p.id, title: p.title, description: p.description })), null, 2)
        }
        case "list_tasks": {
          const params = new URLSearchParams({ per_page: "50" })
          if (filter) params.set("filter", filter)
          const path = projectId ? `/projects/${projectId}/tasks` : "/tasks"
          return JSON.stringify((await call("GET", `${path}?${params}`)).map(brief), null, 2)
        }
        case "create_task": {
          if (!projectId || !title) return "create_task needs projectId and title."
          const created = await call("PUT", `/projects/${projectId}/tasks`, {
            title,
            description,
            due_date: dueDate,
            priority,
          })
          return JSON.stringify(brief(created), null, 2)
        }
        default: {
          if (!taskId) return `${action} needs taskId.`
          // Vikunja's update replaces the task, so merge changes into the current copy.
          const current = await call("GET", `/tasks/${taskId}`)
          const changes: Record<string, unknown> = {}
          if (action === "complete_task") changes.done = true
          if (action === "reopen_task") changes.done = false
          if (action === "update_task") {
            if (title !== undefined) changes.title = title
            if (description !== undefined) changes.description = description
            if (dueDate !== undefined) changes.due_date = dueDate
            if (priority !== undefined) changes.priority = priority
          }
          return JSON.stringify(brief(await call("POST", `/tasks/${taskId}`, { ...current, ...changes })), null, 2)
        }
      }
    } catch (err) {
      return `Vikunja ${action} failed: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})
