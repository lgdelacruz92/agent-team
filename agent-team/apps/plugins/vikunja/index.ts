import { Plugin } from "@opencode/plugin"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

// Vikunja runs in the blackberry stack. Reach it through the SSM port forward on the host
// (./ssh-ec2.sh --forward vikunja); the container sees the host as host.docker.internal.
const BASE_URL = (process.env.VIKUNJA_URL ?? "http://host.docker.internal:3456").replace(/\/$/, "")
const TOKEN = process.env.VIKUNJA_API_TOKEN ?? ""
const TIMEOUT_MS = Number(process.env.VIKUNJA_TIMEOUT_MS ?? 30 * 1000)

// Agents listed here work on one goal at a time: they must call set_goal first, new tickets get the goal's
// label, list_tasks only shows that goal, and tickets labeled for another goal are off limits.
const SCOPED_AGENTS = (process.env.VIKUNJA_SCOPED_AGENTS ?? "cto").split(",").map((a) => a.trim())
const GOAL_FILE = process.env.VIKUNJA_GOAL_FILE ?? "/root/.local/share/opencode/vikunja-goals.json"
const GOAL_PREFIX = "goal:"
// Vikunja answers HTTP 500 to concurrent writes in one project (3 of 4 parallel creates failed in testing),
// so bulk actions write one ticket at a time. They still cost the model a single tool call.
const CONCURRENCY = 1
const MAX_PAGES = 10
// Vikunja stores "no due date" as the zero date.
const NO_DUE_DATE = "0001-01-01T00:00:00Z"

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
  labels: (t.labels ?? []).map((l: any) => l.title),
})

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
const dueValue = (dueDate: string) => (dueDate === "none" ? NO_DUE_DATE : dueDate)
const json = (value: unknown) => JSON.stringify(value, null, 2)

// ---- Goal scope: which goal each session is working on, kept on disk so restarts keep it ----

let goals: Record<string, string> = {}
try {
  goals = JSON.parse(readFileSync(GOAL_FILE, "utf8"))
} catch {}

function saveGoals() {
  try {
    mkdirSync(dirname(GOAL_FILE), { recursive: true })
    writeFileSync(GOAL_FILE, JSON.stringify(goals))
  } catch {}
}

const isScoped = (context: any) => SCOPED_AGENTS.includes(context?.agent)

function activeGoal(context: any): string | undefined {
  if (!isScoped(context)) return undefined
  const goal = goals[context.sessionID]
  if (!goal) throw new Error("no goal is set for this session. Call set_goal with the goal's name first.")
  return goal
}

// Tickets carrying another goal's label are off limits; tickets with no goal label (older ones) are allowed.
function guard(context: any, task: any) {
  const goal = activeGoal(context)
  if (!goal) return
  const labels: string[] = (task.labels ?? []).map((l: any) => l.title)
  const others = labels.filter((l) => l.startsWith(GOAL_PREFIX) && l !== goal)
  if (others.length && !labels.includes(goal)) {
    throw new Error(`task ${task.id} belongs to ${others.join(", ")}, not ${goal}. Call set_goal to switch goals.`)
  }
}

// ---- Helpers ----

async function pool<T>(items: any[], fn: (item: any, index: number) => Promise<T>): Promise<(T | { index: number; error: string })[]> {
  const out: any[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      try {
        out[index] = await fn(items[index], index)
      } catch (err) {
        out[index] = { index, error: message(err) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return out
}

// Finds the labels by title, creating the ones that do not exist yet. Done once up front so the
// parallel workers never race to create the same label.
async function ensureLabels(titles: string[]): Promise<Map<string, any>> {
  const wanted = [...new Set(titles)]
  const found = new Map<string, any>()
  if (!wanted.length) return found
  const existing = (await call("GET", "/labels?per_page=200")) ?? []
  for (const title of wanted) {
    found.set(title, existing.find((l: any) => l.title === title) ?? (await call("PUT", "/labels", { title })))
  }
  return found
}

async function listAll(path: string, params: URLSearchParams): Promise<any[]> {
  const tasks: any[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    params.set("page", String(page))
    const batch = (await call("GET", `${path}?${params}`)) ?? []
    tasks.push(...batch)
    if (batch.length < Number(params.get("per_page"))) break
  }
  return tasks
}

async function createOne(item: any, labels: Map<string, any>, goal?: string) {
  if (!item.projectId || !item.title) throw new Error("needs projectId and title")
  const created = await call("PUT", `/projects/${item.projectId}/tasks`, {
    title: item.title,
    description: item.description,
    due_date: item.dueDate === undefined ? undefined : dueValue(item.dueDate),
    priority: item.priority,
  })
  for (const title of [...(item.labels ?? []), ...(goal ? [goal] : [])]) {
    await call("PUT", `/tasks/${created.id}/labels`, { label_id: labels.get(title).id })
  }
  return created
}

// Vikunja's update replaces the task, so merge changes into the current copy.
async function updateOne(context: any, taskId: number, changes: any) {
  const current = await call("GET", `/tasks/${taskId}`)
  guard(context, current)
  const merged: Record<string, unknown> = {}
  if (changes.done !== undefined) merged.done = changes.done
  if (changes.title !== undefined) merged.title = changes.title
  if (changes.description !== undefined) merged.description = changes.description
  if (changes.dueDate !== undefined) merged.due_date = dueValue(changes.dueDate)
  if (changes.priority !== undefined) merged.priority = changes.priority
  return call("POST", `/tasks/${taskId}`, { ...current, ...merged })
}

async function run(input: any, context: any): Promise<string> {
  const { action, projectId, taskId, title, description, dueDate, priority, filter, label, comment, goal, tasks, taskIds, add, remove } = input
  if (!TOKEN) return "Vikunja failed: VIKUNJA_API_TOKEN is not set in the container."
  try {
    switch (action) {
      case "set_goal": {
        const slug = String(goal ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40)
        if (!slug) return "set_goal needs goal, a short name for the goal you are planning."
        goals[context.sessionID] = GOAL_PREFIX + slug
        saveGoals()
        return `Active goal: ${GOAL_PREFIX + slug}. New tickets get this label, and list_tasks shows only this goal's tickets.`
      }
      case "list_projects": {
        const projects = await call("GET", "/projects")
        return json(projects.map((p: any) => ({ id: p.id, title: p.title, description: p.description })))
      }
      case "list_tasks": {
        const scope = activeGoal(context)
        const params = new URLSearchParams({ per_page: "50" })
        if (filter) params.set("filter", filter)
        const path = projectId ? `/projects/${projectId}/tasks` : "/tasks"
        let found: any[]
        if (scope) {
          found = (await listAll(path, params)).map(brief).filter((t: any) => t.labels.includes(scope))
        } else {
          found = (await call("GET", `${path}?${params}`)).map(brief)
        }
        return json(label ? found.filter((t: any) => t.labels.includes(label)) : found)
      }
      case "create_task": {
        const scope = activeGoal(context)
        const labels = await ensureLabels(scope ? [scope] : [])
        const created = await createOne({ projectId, title, description, dueDate, priority }, labels, scope)
        return json(brief(await call("GET", `/tasks/${created.id}`)))
      }
      case "create_tasks": {
        if (!Array.isArray(tasks) || !tasks.length) return "create_tasks needs tasks, a list of {projectId, title, ...}."
        const scope = activeGoal(context)
        const labels = await ensureLabels([...tasks.flatMap((t: any) => t.labels ?? []), ...(scope ? [scope] : [])])
        const results = await pool(tasks, async (item) => {
          const created = await createOne(item, labels, scope)
          return { id: created.id, title: created.title }
        })
        const failed = results.filter((r: any) => r.error).length
        return json({ created: results.length - failed, failed, results })
      }
      case "update_tasks": {
        if (!Array.isArray(tasks) || !tasks.length) return "update_tasks needs tasks, a list of {taskId, ...changes}."
        const results = await pool(tasks, async (item) => {
          if (!item.taskId) throw new Error("needs taskId")
          const updated = await updateOne(context, item.taskId, item)
          return { id: updated.id, title: updated.title }
        })
        const failed = results.filter((r: any) => r.error).length
        return json({ updated: results.length - failed, failed, results })
      }
      case "label_tasks": {
        if (!Array.isArray(taskIds) || !taskIds.length) return "label_tasks needs taskIds."
        if (!(add?.length || remove?.length)) return "label_tasks needs add and/or remove."
        const labels = await ensureLabels(add ?? [])
        const existing = remove?.length ? ((await call("GET", "/labels?per_page=200")) ?? []) : []
        const results = await pool(taskIds, async (id) => {
          if (isScoped(context)) guard(context, await call("GET", `/tasks/${id}`))
          for (const name of add ?? []) await call("PUT", `/tasks/${id}/labels`, { label_id: labels.get(name).id })
          for (const name of remove ?? []) {
            const found = existing.find((l: any) => l.title === name)
            if (found) await call("DELETE", `/tasks/${id}/labels/${found.id}`)
          }
          return { id }
        })
        const failed = results.filter((r: any) => r.error).length
        return json({ labeled: results.length - failed, failed, results })
      }
      case "add_label":
      case "remove_label": {
        if (!taskId || !label) return `${action} needs taskId and label.`
        if (isScoped(context)) guard(context, await call("GET", `/tasks/${taskId}`))
        const labels = (await call("GET", "/labels?per_page=200")) ?? []
        let found = labels.find((l: any) => l.title === label)
        if (action === "remove_label") {
          if (found) await call("DELETE", `/tasks/${taskId}/labels/${found.id}`)
        } else {
          found ??= await call("PUT", "/labels", { title: label })
          await call("PUT", `/tasks/${taskId}/labels`, { label_id: found.id })
        }
        return json(brief(await call("GET", `/tasks/${taskId}`)))
      }
      case "add_comment": {
        if (!taskId || !comment) return "add_comment needs taskId and comment."
        if (isScoped(context)) guard(context, await call("GET", `/tasks/${taskId}`))
        await call("PUT", `/tasks/${taskId}/comments`, { comment })
        return "Comment added."
      }
      case "list_comments": {
        if (!taskId) return "list_comments needs taskId."
        if (isScoped(context)) guard(context, await call("GET", `/tasks/${taskId}`))
        const comments = (await call("GET", `/tasks/${taskId}/comments`)) ?? []
        return json(comments.map((c: any) => ({ author: c.author?.username, created: c.created, comment: c.comment })))
      }
      default: {
        if (!taskId) return `${action} needs taskId.`
        const changes: Record<string, unknown> = {}
        if (action === "complete_task") changes.done = true
        if (action === "reopen_task") changes.done = false
        if (action === "update_task") Object.assign(changes, { title, description, dueDate, priority })
        return json(brief(await updateOne(context, taskId, changes)))
      }
    }
  } catch (err) {
    return `Vikunja ${action} failed: ${message(err)}`
  }
}

const ACTIONS = [
  "set_goal",
  "list_projects",
  "list_tasks",
  "create_task",
  "create_tasks",
  "update_task",
  "update_tasks",
  "complete_task",
  "reopen_task",
  "add_label",
  "remove_label",
  "label_tasks",
  "add_comment",
  "list_comments",
]

export default Plugin.define({
  id: "vikunja",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "vikunja",
        description:
          "Track work in Vikunja. Actions: set_goal (needs goal: a short name; scopes this session to one goal, call it first when planning); " +
          "list_projects; list_tasks (optional projectId, optional filter such as 'done = false'; optional label to keep only tasks carrying it); " +
          "create_task (needs projectId and title); update_task (needs taskId, change any of title, description, dueDate, priority; dueDate 'none' clears it); " +
          "complete_task and reopen_task (need taskId); add_label and remove_label (need taskId and label, e.g. the states 'ready', 'assigned', 'in-progress', 'review', 'retry', 'completed', or a worker name); " +
          "add_comment (needs taskId and comment) and list_comments (needs taskId). " +
          "BULK, prefer these whenever you touch more than one ticket, they take one call instead of many: " +
          "create_tasks (needs tasks: [{projectId, title, description?, dueDate?, priority?, labels?}]); " +
          "update_tasks (needs tasks: [{taskId, title?, description?, dueDate?, priority?, done?}]); " +
          "label_tasks (needs taskIds, plus add and/or remove: label titles). Bulk calls return one short result per ticket, with its error if it failed, and a failed count: always check it and retry only the failed tickets. There is no delete.",
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ACTIONS, description: "What to do" },
            goal: { type: "string", description: "Short goal name (set_goal), e.g. 'todo web app'" },
            projectId: { type: "number", description: "Vikunja project ID (create_task, list_tasks)" },
            taskId: { type: "number", description: "Vikunja task ID (update_task, complete_task, reopen_task, labels, comments)" },
            title: { type: "string", description: "Task title" },
            description: { type: "string", description: "Task description, e.g. the acceptance criteria and assigned team member" },
            dueDate: { type: "string", description: "ISO 8601 date-time, e.g. 2026-11-01T17:00:00Z, or 'none' to clear the due date" },
            priority: { type: "integer", minimum: 0, maximum: 5, description: "0 unset, 1 low ... 5 do now" },
            filter: { type: "string", description: "Vikunja filter for list_tasks, e.g. 'done = false'" },
            label: { type: "string", description: "Label title (add_label, remove_label, list_tasks)" },
            comment: { type: "string", description: "Comment text (add_comment)" },
            tasks: {
              type: "array",
              description: "Tickets for create_tasks (projectId, title, ...) or update_tasks (taskId, ...changes)",
              items: {
                type: "object",
                properties: {
                  projectId: { type: "number" },
                  taskId: { type: "number" },
                  title: { type: "string" },
                  description: { type: "string" },
                  dueDate: { type: "string", description: "ISO 8601 date-time, or 'none' to clear (update_tasks)" },
                  priority: { type: "integer", minimum: 0, maximum: 5 },
                  labels: { type: "array", items: { type: "string" }, description: "Label titles to attach (create_tasks)" },
                  done: { type: "boolean", description: "Mark done or reopen (update_tasks)" },
                },
                additionalProperties: false,
              },
            },
            taskIds: { type: "array", items: { type: "number" }, description: "Ticket IDs for label_tasks" },
            add: { type: "array", items: { type: "string" }, description: "Label titles to add (label_tasks)" },
            remove: { type: "array", items: { type: "string" }, description: "Label titles to remove (label_tasks)" },
          },
          required: ["action"],
          additionalProperties: false,
        },
        execute: async (input: any, context: any) => ({ content: await run(input, context) }),
      })
    })
  },
})
