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
const GOAL_PREFIX = "GOAL-"
const isGoalLabel = (title: string) => /^GOAL-\d+$/i.test(title)
// Kanban column titles, compared case-insensitively. Same names as the controller's config.
const STATUSES: Record<string, string> = {
  ready: "Ready",
  "in-progress": "In progress",
  review: "Review",
  retry: "Retry",
  done: "Done",
  // Parking column for superseded tickets: the controller ignores it, so they are never picked up.
  archived: "Archived",
}
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
  relations: Object.fromEntries(
    Object.entries(t.related_tasks ?? {}).map(([kind, list]: [string, any]) => [
      kind,
      (list ?? []).map((r: any) => ({ id: r.id, title: r.title, done: r.done })),
    ]),
  ),
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
  const others = labels.filter((l) => isGoalLabel(l) && l.toUpperCase() !== goal)
  if (others.length && !labels.some((l) => l.toUpperCase() === goal)) {
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

// The Kanban view and its columns for a project, with each column's title lowercased.
async function loadKanban(projectId: number) {
  const views: any[] = await call("GET", `/projects/${projectId}/views`)
  const view = views.find((v) => v.view_kind === "kanban")
  if (!view) throw new Error(`project ${projectId} has no Kanban view`)
  const columns: any[] = await call("GET", `/projects/${projectId}/views/${view.id}/tasks?per_page=200`)
  return { projectId, viewId: view.id as number, columns }
}

// Normalizes a status name such as "In progress" or "in-progress" to a STATUSES key.
const statusKey = (status: string) => String(status ?? "").trim().toLowerCase().replace(/\s+/g, "-")

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
  const { action, projectId, taskId, title, description, dueDate, priority, filter, label, comment, goal, tasks, taskIds, add, remove, status, blockedBy, blocking, projectIds, columns } = input
  if (!TOKEN) return "Vikunja failed: VIKUNJA_API_TOKEN is not set in the container."
  try {
    switch (action) {
      case "set_goal": {
        const n = /^(?:GOAL[-:\s]*)?(\d+)$/i.exec(String(goal ?? "").trim())?.[1]
        if (!n || Number(n) < 1) return "set_goal needs goal, the goal number: 1, 2, 3 ... (or GOAL-1)."
        const label = `${GOAL_PREFIX}${Number(n)}`
        goals[context.sessionID] = label
        saveGoals()
        return `Active goal: ${label}. New tickets get this label, and list_tasks shows only this goal's tickets.`
      }
      case "list_goals": {
        // Every GOAL-<n> label across all projects, so the next free number is easy to find.
        const params = new URLSearchParams({ per_page: "50" })
        const found = new Map<string, { goal: string; tasks: number; open: number; projects: Set<number> }>()
        for (const t of await listAll("/tasks", params)) {
          for (const l of t.labels ?? []) {
            if (!isGoalLabel(l.title)) continue
            const key = l.title.toUpperCase()
            const entry = found.get(key) ?? { goal: key, tasks: 0, open: 0, projects: new Set<number>() }
            entry.tasks++
            if (!t.done) entry.open++
            entry.projects.add(t.project_id)
            found.set(key, entry)
          }
        }
        const goalsFound = [...found.values()]
          .map((g) => ({ ...g, projects: [...g.projects] }))
          .sort((a, b) => Number(a.goal.slice(5)) - Number(b.goal.slice(5)))
        const highest = goalsFound.reduce((m, g) => Math.max(m, Number(g.goal.slice(5))), 0)
        return json({ goals: goalsFound, nextFreeNumber: highest + 1 })
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
        if (label) found = found.filter((t: any) => t.labels.includes(label))
        if (status) {
          const title = STATUSES[statusKey(status)]
          if (!title) return `list_tasks status must be one of: ${Object.values(STATUSES).join(", ")}.`
          const projects = projectId ? [Number(projectId)] : [...new Set(found.map((t: any) => t.project_id))]
          const inStatus = new Set<number>()
          for (const id of projects) {
            const { columns } = await loadKanban(id)
            for (const c of columns) {
              if (String(c.title).toLowerCase() === title.toLowerCase()) for (const t of c.tasks ?? []) inStatus.add(t.id)
            }
          }
          found = found.filter((t: any) => inStatus.has(t.id))
        }
        return json(found)
      }
      case "get_task": {
        if (!taskId) return "get_task needs taskId."
        const task = await call("GET", `/tasks/${taskId}`)
        if (isScoped(context)) guard(context, task)
        // The Kanban column is the ticket's status; look it up so set_status can be verified.
        let status: string | null = null
        try {
          const { columns } = await loadKanban(task.project_id)
          const column = columns.find((c: any) => (c.tasks ?? []).some((t: any) => t.id === task.id))
          status = column?.title ?? null
        } catch {}
        return json({ ...brief(task), status })
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
      case "create_columns": {
        // Adds the missing Kanban columns to each project's board. Existing columns are left alone.
        const ids: number[] = Array.isArray(projectIds) && projectIds.length ? projectIds : projectId ? [projectId] : []
        if (!ids.length) return "create_columns needs projectId or projectIds. Optional columns: titles to create, default Ready, In progress, Review, Retry, Done."
        const wanted: string[] = Array.isArray(columns) && columns.length ? columns : ["Ready", "In progress", "Review", "Retry", "Done"]
        const results = await pool(ids, async (id) => {
          const board = await loadKanban(id)
          const have = new Set(board.columns.map((c: any) => String(c.title).toLowerCase()))
          const created: string[] = []
          for (const title of wanted) {
            if (have.has(title.toLowerCase())) continue
            await call("PUT", `/projects/${id}/views/${board.viewId}/buckets`, { title })
            have.add(title.toLowerCase())
            created.push(title)
          }
          return { projectId: id, created, existing: board.columns.map((c: any) => c.title) }
        })
        const failed = results.filter((r: any) => r.error).length
        return json({ projects: results.length - failed, failed, results })
      }
      case "set_status": {
        if (!Array.isArray(taskIds) || !taskIds.length) return "set_status needs taskIds and status."
        const title = STATUSES[statusKey(status)]
        if (!title) return `set_status status must be one of: ${Object.values(STATUSES).join(", ")}.`
        const boards = new Map<number, Awaited<ReturnType<typeof loadKanban>>>()
        const results = await pool(taskIds, async (id) => {
          const task = await call("GET", `/tasks/${id}`)
          guard(context, task)
          if (!boards.has(task.project_id)) boards.set(task.project_id, await loadKanban(task.project_id))
          const board = boards.get(task.project_id)!
          const column = board.columns.find((c: any) => String(c.title).toLowerCase() === title.toLowerCase())
          if (!column) throw new Error(`project ${task.project_id} has no "${title}" column`)
          await call("POST", `/projects/${board.projectId}/views/${board.viewId}/buckets/${column.id}/tasks`, {
            task_id: id,
            bucket_id: column.id,
            project_view_id: board.viewId,
            project_id: board.projectId,
          })
          // Vikunja's Done column marks the task done itself; keep the done flag in step for the other columns.
          const wantDone = statusKey(status) === "done"
          if (statusKey(status) !== "archived" && wantDone !== !!task.done) await call("POST", `/tasks/${id}`, { ...task, done: wantDone })
          return { id, status: title }
        })
        const failed = results.filter((r: any) => r.error).length
        return json({ updated: results.length - failed, failed, results })
      }
      case "add_relations": {
        if (!taskId || !Array.isArray(blockedBy) || !blockedBy.length) return "add_relations needs taskId and blockedBy, the IDs of the tickets that must be accepted first."
        guard(context, await call("GET", `/tasks/${taskId}`))
        const results = await pool(blockedBy, async (other) => {
          // "blocked" on this ticket: Vikunja adds the inverse "blocking" relation on the other one.
          await call("PUT", `/tasks/${taskId}/relations`, { other_task_id: other, relation_kind: "blocked" })
          return { id: other }
        })
        const failed = results.filter((r: any) => r.error).length
        return json({ related: results.length - failed, failed, results })
      }
      case "remove_relations": {
        const blockers = Array.isArray(blockedBy) ? blockedBy : []
        const blocked = Array.isArray(blocking) ? blocking : []
        if (!taskId || (!blockers.length && !blocked.length)) return "remove_relations needs taskId and blockedBy (tickets that block it) and/or blocking (tickets it blocks): the IDs whose relation to remove."
        guard(context, await call("GET", `/tasks/${taskId}`))
        const links = [
          ...blockers.map((other: number) => ({ other, kind: "blocked" })),
          ...blocked.map((other: number) => ({ other, kind: "blocking" })),
        ]
        const results = await pool(links, async (link: { other: number; kind: string }) => {
          // Vikunja deletes the inverse relation on the other ticket itself.
          await call("DELETE", `/tasks/${taskId}/relations/${link.kind}/${link.other}`)
          return { id: link.other, kind: link.kind }
        })
        const failed = results.filter((r: any) => r.error).length
        return json({ removed: results.length - failed, failed, results })
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
  "list_goals",
  "list_projects",
  "list_tasks",
  "get_task",
  "create_task",
  "create_tasks",
  "update_task",
  "update_tasks",
  "complete_task",
  "reopen_task",
  "add_label",
  "remove_label",
  "label_tasks",
  "set_status",
  "create_columns",
  "add_relations",
  "remove_relations",
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
          "Track work in Vikunja. Actions: set_goal (needs goal: the goal number, e.g. 1; scopes this session to the label GOAL-1, call it first when planning); " +
          "list_goals (every GOAL-<n> label across all projects with ticket counts, and the next free number); " +
          "list_projects; list_tasks (optional projectId, optional filter such as 'done = false'; optional label to keep only tasks carrying it; optional status: Ready, In progress, Review, Retry or Done); get_task (needs taskId; returns one ticket with its description, labels, status (Kanban column) and relations: blocked = tickets that block it, blocking = tickets it blocks); " +
          "create_task (needs projectId and title); update_task (needs taskId, change any of title, description, dueDate, priority; dueDate 'none' clears it); " +
          "complete_task and reopen_task (need taskId); add_label and remove_label (need taskId and label, e.g. the states 'ready', 'assigned', 'in-progress', 'review', 'retry', 'completed', or a worker name); " +
          "set_status (needs taskIds and status: Ready, In progress, Review, Retry, Done or Archived; moves the tickets to that Kanban column; Archived parks superseded tickets where the team never picks them up, it needs that column to exist); " +
          "create_columns (needs projectId or projectIds; optional columns: titles, default Ready, In progress, Review, Retry, Done; adds only the missing Kanban columns, so it is safe to repeat; add 'Archived' to columns when you need it); " +
          "add_relations (needs taskId and blockedBy: IDs of the tickets that must be accepted first; Vikunja adds the inverse 'blocking' relation itself); " +
          "remove_relations (needs taskId and blockedBy and/or blocking: IDs of tickets that block it and IDs of tickets it blocks; removes those relations, and Vikunja removes the inverse on the other ticket; the tickets themselves are untouched); " +
          "add_comment (needs taskId and comment) and list_comments (needs taskId). " +
          "BULK, prefer these whenever you touch more than one ticket, they take one call instead of many: " +
          "create_tasks (needs tasks: [{projectId, title, description?, dueDate?, priority?, labels?}]); " +
          "update_tasks (needs tasks: [{taskId, title?, description?, dueDate?, priority?, done?}]); " +
          "label_tasks (needs taskIds, plus add and/or remove: label titles). Bulk calls return one short result per ticket, with its error if it failed, and a failed count: always check it and retry only the failed tickets. Tasks cannot be deleted; only relations can be removed.",
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ACTIONS, description: "What to do" },
            goal: { type: "string", description: "Goal number (set_goal), e.g. '1' or 'GOAL-1'" },
            status: { type: "string", description: "Kanban status (set_status, list_tasks): Ready, In progress, Review, Retry or Done" },
            blockedBy: { type: "array", items: { type: "number" }, description: "IDs of the tickets that block taskId (add_relations, remove_relations)" },
            blocking: { type: "array", items: { type: "number" }, description: "IDs of the tickets that taskId blocks (remove_relations)" },
            projectId: { type: "number", description: "Vikunja project ID (create_task, list_tasks, create_columns)" },
            projectIds: { type: "array", items: { type: "number" }, description: "Project IDs (create_columns)" },
            columns: { type: "array", items: { type: "string" }, description: "Kanban column titles to create (create_columns)" },
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
            taskIds: { type: "array", items: { type: "number" }, description: "Ticket IDs for label_tasks and set_status" },
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
