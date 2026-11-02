// REST client for Vikunja, exposed as a singleton: tasks, Kanban buckets and comments.
import { config } from "../config.js"
import type {
  VikunjaBucketInterface,
  VikunjaCommentInterface,
  VikunjaTaskInterface,
  VikunjaViewInterface,
} from "../interfaces/vikunja.interface.js"

// An HTTP failure from Vikunja, with its status code.
export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

// Talks to the Vikunja API. Use Vikunja.getInstance() so the whole process shares one client
// and one write queue.
export class Vikunja {
  private static instance: Vikunja | null = null

  // Vikunja returns HTTP 500 on concurrent writes, so writes are chained and run one at a time.
  private writes: Promise<unknown> = Promise.resolve()

  // Private so nothing can build a second client.
  private constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs: number,
    private readonly projectId: number,
  ) {}

  // Returns the shared client, creating it from config on first use.
  static getInstance(): Vikunja {
    if (!Vikunja.instance) {
      Vikunja.instance = new Vikunja(
        config.vikunjaUrl,
        config.vikunjaToken,
        config.vikunjaTimeoutMs,
        config.projectId,
      )
    }

    return Vikunja.instance
  }

  // Sends one request and returns the parsed JSON (null for 204).
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let payload: string | undefined
    if (body !== undefined) {
      payload = JSON.stringify(body)
    }

    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: payload,
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!res.ok) {
      throw new HttpError(`Vikunja ${method} ${path} returned ${res.status}: ${await res.text()}`, res.status)
    }

    if (res.status === 204) {
      return null as T
    }

    return (await res.json()) as T
  }

  // Queues a write behind the previous one and retries it once on failure.
  private write<T>(method: string, path: string, body?: unknown): Promise<T> {
    const run = async (): Promise<T> => {
      try {
        return await this.call<T>(method, path, body)
      } catch (err) {
        console.error(`write failed, retrying once: ${(err as Error).message}`)
        await new Promise((resolve) => setTimeout(resolve, 500))

        return this.call<T>(method, path, body)
      }
    }

    // Chain on the previous write whether it succeeded or failed.
    const next = this.writes.then(run, run)
    this.writes = next.catch(() => {})

    return next
  }

  // Finds the project's Kanban view.
  private async kanbanView(): Promise<VikunjaViewInterface> {
    const views = await this.call<VikunjaViewInterface[]>("GET", `/projects/${this.projectId}/views`)
    const kanban = views.find((view) => view.view_kind === "kanban")

    if (!kanban) {
      throw new Error(`project ${this.projectId} has no Kanban view`)
    }

    return kanban
  }

  // Loads the Kanban buckets of the project, each with its tasks.
  async listBuckets(): Promise<VikunjaBucketInterface[]> {
    const kanban = await this.kanbanView()

    return this.call<VikunjaBucketInterface[]>("GET", `/projects/${this.projectId}/views/${kanban.id}/tasks?per_page=200`)
  }

  // Tasks in the Ready column that no other task blocks.
  async listUnblockedReadyTasks(): Promise<VikunjaTaskInterface[]> {
    const buckets = await this.listBuckets()
    const tasks = buckets
      .filter((bucket) => bucket.title.toLowerCase() === "ready")
      .flatMap((bucket) => bucket.tasks ?? [])

    return tasks.filter((task) => (task.related_tasks?.blocked ?? []).length === 0)
  }

  // Reads one task by id.
  getTask(taskId: number): Promise<VikunjaTaskInterface> {
    return this.call<VikunjaTaskInterface>("GET", `/tasks/${taskId}`)
  }

  // Moves a task into the bucket with the given title (case-insensitive).
  async moveTask(taskId: number, bucketTitle: string): Promise<void> {
    const kanban = await this.kanbanView()
    const buckets = await this.listBuckets()
    const bucket = buckets.find((b) => b.title.toLowerCase() === bucketTitle.toLowerCase())

    if (!bucket) {
      throw new Error(`the Kanban view has no "${bucketTitle}" column`)
    }

    await this.write("POST", `/projects/${this.projectId}/views/${kanban.id}/buckets/${bucket.id}/tasks`, {
      task_id: taskId,
      bucket_id: bucket.id,
      project_view_id: kanban.id,
      project_id: this.projectId,
    })
  }

  // Comments of a task, oldest first.
  async listComments(taskId: number): Promise<VikunjaCommentInterface[]> {
    const comments = (await this.call<VikunjaCommentInterface[] | null>("GET", `/tasks/${taskId}/comments`)) ?? []

    return comments.sort((a, b) => a.id - b.id)
  }
}
