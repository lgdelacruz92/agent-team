// REST client for Vikunja: tasks, relations, Kanban status, comments.
import { config } from "../config.js"
import { htmlToText } from "../components/text.js"
import type { Board, Comment } from "../interfaces/vikunja.js"
import type { Status, Ticket } from "../interfaces/ticket.js"

// An HTTP failure from Vikunja, with its status code.
export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

// Sends one request to the Vikunja API and returns the parsed JSON (null for 204).
async function call(method: string, path: string, body?: unknown): Promise<any> {
  let payload: string | undefined
  if (body !== undefined) {
    payload = JSON.stringify(body)
  }

  const res = await fetch(`${config.vikunjaUrl}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.vikunjaToken}` },
    body: payload,
    signal: AbortSignal.timeout(config.vikunjaTimeoutMs),
  })

  if (!res.ok) {
    throw new HttpError(`Vikunja ${method} ${path} returned ${res.status}: ${await res.text()}`, res.status)
  }

  if (res.status === 204) {
    return null
  }

  return res.json()
}

// Vikunja returns HTTP 500 on concurrent writes, so writes go one at a time and are retried once.
let writes: Promise<unknown> = Promise.resolve()

function write<T>(method: string, path: string, body?: unknown): Promise<T> {
  const run = async () => {
    try {
      return await call(method, path, body)
    } catch (err) {
      console.error(`write failed, retrying once: ${(err as Error).message}`)
      await new Promise((resolve) => setTimeout(resolve, 500))

      return call(method, path, body)
    }
  }

  // Chain on the previous write whether it succeeded or failed.
  const next = writes.then(run, run)
  writes = next.catch(() => {})

  return next as Promise<T>
}

// Maps a lowercase bucket title to its status. Only the five columns in config.buckets carry a status;
// any other column (To-Do, Doing, Archived, ...) is ignored, and tickets in it are never started.
function statusByTitle(): Map<string, Status> {
  const map = new Map<string, Status>()

  for (const status of Object.keys(config.buckets) as Status[]) {
    map.set(config.buckets[status].toLowerCase(), status)
  }

  return map
}

// Loads the Kanban view of the project: every task with its bucket.
export async function loadBoard(): Promise<Board> {
  const projectId = config.projectId
  const views: any[] = await call("GET", `/projects/${projectId}/views`)
  const kanban = views.find((view) => view.view_kind === "kanban")
  if (!kanban) {
    throw new Error(`project ${projectId} has no Kanban view`)
  }

  const titles = statusByTitle()
  const buckets = new Map<Status, number>()
  const statusOf = new Map<number, Status>()
  const columnOf = new Map<number, string>()
  const tasks: any[] = []

  const columns: any[] = await call("GET", `/projects/${projectId}/views/${kanban.id}/tasks?per_page=200`)
  for (const column of columns) {
    const status = titles.get(String(column.title).toLowerCase())
    if (status) {
      buckets.set(status, column.id)
    }

    for (const task of column.tasks ?? []) {
      tasks.push(task)
      columnOf.set(task.id, String(column.title))

      if (status) {
        statusOf.set(task.id, status)
      }
    }
  }

  return { projectId, viewId: kanban.id, buckets, tasks, statusOf, columnOf }
}

// Reads N from the GOAL-N label, or null when the task has none.
function goalOf(task: any): number | null {
  for (const label of task.labels ?? []) {
    const match = /^GOAL-(\d+)$/i.exec(label.title ?? "")

    if (match) {
      return Number(match[1])
    }
  }

  return null
}

// Vikunja uses a year-0001 date for "no due date".
function dueOf(task: any): string | null {
  if (!task.due_date || task.due_date.startsWith("0001")) {
    return null
  }

  return task.due_date
}

// Status of a task outside the project's board: Done if marked done, otherwise unknown.
async function foreignStatus(id: number): Promise<Status | null> {
  try {
    const task = await call("GET", `/tasks/${id}`)

    if (task.done) {
      return "done"
    }
  } catch {
    // An unreadable blocker counts as unknown, which keeps the ticket blocked.
  }

  return null
}

// Status of one blocker: from the board, else from the relation itself, else by asking Vikunja.
async function blockerStatus(board: Board, related: any): Promise<Status | null> {
  const onBoard = board.statusOf.get(related.id)
  if (onBoard) {
    return onBoard
  }

  if (related.done) {
    return "done"
  }

  return foreignStatus(related.id)
}

// Turns the board into tickets the scheduler can rank.
export async function listTickets(board: Board): Promise<Ticket[]> {
  const tickets: Ticket[] = []

  for (const task of board.tasks) {
    const related = task.related_tasks ?? {}

    const blockers = await Promise.all(
      (related.blocked ?? []).map(async (blocked: any) => ({
        id: blocked.id as number,
        status: await blockerStatus(board, blocked),
      })),
    )

    tickets.push({
      id: task.id,
      title: task.title,
      description: htmlToText(task.description ?? ""),
      dueDate: dueOf(task),
      status: board.statusOf.get(task.id) ?? null,
      column: board.columnOf.get(task.id) ?? null,
      goal: goalOf(task),
      blockers,
      blockingCount: (related.blocking ?? []).length,
      failures: 0,
    })
  }

  return tickets
}

// Comments of a ticket in plain text, oldest first.
export async function listComments(taskId: number): Promise<Comment[]> {
  const comments: any[] = (await call("GET", `/tasks/${taskId}/comments`)) ?? []

  return comments
    .map((c) => ({ id: c.id, created: c.created, comment: htmlToText(c.comment ?? "") }))
    .sort((a, b) => a.id - b.id)
}

// Adds a comment to a ticket.
export async function addComment(taskId: number, comment: string): Promise<void> {
  await write("PUT", `/tasks/${taskId}/comments`, { comment })
}

// Moves a ticket to the Kanban column for the status.
export async function setStatus(board: Board, taskId: number, status: Status): Promise<void> {
  const bucketId = board.buckets.get(status)
  if (!bucketId) {
    throw new Error(`the Kanban view has no "${config.buckets[status]}" column`)
  }

  await write("POST", `/projects/${board.projectId}/views/${board.viewId}/buckets/${bucketId}/tasks`, {
    task_id: taskId,
    bucket_id: bucketId,
    project_view_id: board.viewId,
    project_id: board.projectId,
  })

  board.statusOf.set(taskId, status)
  board.columnOf.set(taskId, config.buckets[status])
}
