// REST client for Vikunja: tasks, relations, Kanban status, comments.
import { config } from "./config.js"
import type { Status, Ticket } from "./select.js"

export interface Comment {
  id: number
  created: string
  comment: string
}

interface Board {
  projectId: number
  viewId: number
  /** bucket id by status */
  buckets: Map<Status, number>
  tasks: any[]
  statusOf: Map<number, Status>
}

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${config.vikunjaUrl}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.vikunjaToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(config.vikunjaTimeoutMs),
  })
  if (!res.ok) throw new HttpError(`Vikunja ${method} ${path} returned ${res.status}: ${await res.text()}`, res.status)
  return res.status === 204 ? null : res.json()
}

// Vikunja returns HTTP 500 on concurrent writes, so writes go one at a time and are retried once.
let writes: Promise<unknown> = Promise.resolve()
function write<T>(method: string, path: string, body?: unknown): Promise<T> {
  const run = async () => {
    try {
      return await call(method, path, body)
    } catch (err) {
      console.error(`write failed, retrying once: ${(err as Error).message}`)
      await new Promise((r) => setTimeout(r, 500))
      return call(method, path, body)
    }
  }
  const next = writes.then(run, run)
  writes = next.catch(() => {})
  return next as Promise<T>
}

const statusByTitle = () =>
  new Map<string, Status>(
    (Object.keys(config.buckets) as Status[]).map((s) => [config.buckets[s].toLowerCase(), s] as const),
  )

/** Loads the Kanban view of the project: every task with its bucket. */
export async function loadBoard(): Promise<Board> {
  const projectId = config.projectId
  const views: any[] = await call("GET", `/projects/${projectId}/views`)
  const kanban = views.find((v) => v.view_kind === "kanban")
  if (!kanban) throw new Error(`project ${projectId} has no Kanban view`)

  const titles = statusByTitle()
  const buckets = new Map<Status, number>()
  const tasks: any[] = []
  const statusOf = new Map<number, Status>()

  const columns: any[] = await call("GET", `/projects/${projectId}/views/${kanban.id}/tasks?per_page=200`)
  for (const column of columns) {
    const status = titles.get(String(column.title).toLowerCase())
    if (status) buckets.set(status, column.id)
    for (const task of column.tasks ?? []) {
      tasks.push(task)
      if (status) statusOf.set(task.id, status)
    }
  }
  return { projectId, viewId: kanban.id, buckets, tasks, statusOf }
}

const goalOf = (task: any): number | null => {
  for (const label of task.labels ?? []) {
    const m = /^GOAL-(\d+)$/i.exec(label.title ?? "")
    if (m) return Number(m[1])
  }
  return null
}

const dueOf = (task: any): string | null => (!task.due_date || task.due_date.startsWith("0001") ? null : task.due_date)

/** Status of a task outside the project's board: Done if marked done, otherwise unknown. */
async function foreignStatus(id: number): Promise<Status | null> {
  try {
    const task = await call("GET", `/tasks/${id}`)
    return task.done ? "done" : null
  } catch {
    return null
  }
}

export async function listTickets(board: Board): Promise<Ticket[]> {
  const tickets: Ticket[] = []
  for (const task of board.tasks) {
    const related = task.related_tasks ?? {}
    const blockers = await Promise.all(
      (related.blocked ?? []).map(async (r: any) => ({
        id: r.id as number,
        status: board.statusOf.get(r.id) ?? (r.done ? "done" : await foreignStatus(r.id)),
      })),
    )
    tickets.push({
      id: task.id,
      title: task.title,
      description: task.description ?? "",
      dueDate: dueOf(task),
      status: board.statusOf.get(task.id) ?? null,
      goal: goalOf(task),
      blockers,
      blockingCount: (related.blocking ?? []).length,
      failures: 0,
    })
  }
  return tickets
}

export async function listComments(taskId: number): Promise<Comment[]> {
  const comments: any[] = (await call("GET", `/tasks/${taskId}/comments`)) ?? []
  return comments
    .map((c) => ({ id: c.id, created: c.created, comment: stripHtml(c.comment ?? "") }))
    .sort((a, b) => a.id - b.id)
}

/** Vikunja's editor stores comments as HTML; the markers are matched on plain text. */
function stripHtml(text: string): string {
  if (!/<\/?(p|br|div)\b/i.test(text)) return text
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

export async function addComment(taskId: number, comment: string): Promise<void> {
  await write("PUT", `/tasks/${taskId}/comments`, { comment })
}

export async function setStatus(board: Board, taskId: number, status: Status): Promise<void> {
  const bucketId = board.buckets.get(status)
  if (!bucketId) throw new Error(`the Kanban view has no "${config.buckets[status]}" column`)
  await write("POST", `/projects/${board.projectId}/views/${board.viewId}/buckets/${bucketId}/tasks`, {
    task_id: taskId,
    bucket_id: bucketId,
    project_view_id: board.viewId,
    project_id: board.projectId,
  })
  board.statusOf.set(taskId, status)
}

export type { Board }
