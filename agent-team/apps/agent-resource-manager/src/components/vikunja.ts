// Fetches complete tasks and moves cards on the configured Vikunja board.
import type { ResourceManagerColumn, VikunjaInterface, VikunjaTask } from "../interfaces/vikunja.interface.js"

export interface VikunjaOptions {
  baseUrl: string
  token: string
  projectId: number
  viewId: number
  timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

export class Vikunja implements VikunjaInterface {
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(private readonly options: VikunjaOptions, private readonly fetchRequest: typeof fetch = fetch) {
    const url = new URL(options.baseUrl)
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
      throw new Error("Vikunja baseUrl must be an HTTP or HTTPS URL without credentials, query, or fragment")
    }
    if (!options.token.trim() || !positiveInteger(options.projectId) || !positiveInteger(options.viewId)) {
      throw new Error("Vikunja token, project ID and view ID are required")
    }
    this.baseUrl = url.toString().replace(/\/+$/, "")
    this.timeoutMs = options.timeoutMs ?? 30_000
    if (!positiveInteger(this.timeoutMs)) throw new Error("Vikunja timeout must be a positive integer")
  }

  private async _request(path: string, body?: unknown): Promise<Response> {
    const response = await this.fetchRequest(`${this.baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${this.options.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) throw new Error(`Vikunja ${path} returned HTTP ${response.status}`)
    return response
  }

  async getTask(taskId: number): Promise<VikunjaTask> {
    if (!positiveInteger(taskId)) throw new Error("Vikunja task ID must be a positive integer")
    const task: unknown = await (await this._request(`/api/v1/tasks/${taskId}`)).json()
    if (!isRecord(task) || task.id !== taskId || typeof task.title !== "string" || typeof task.description !== "string") {
      throw new Error("Vikunja returned invalid task details")
    }
    return { id: taskId, title: task.title, description: task.description }
  }

  async moveToColumn(taskId: number, column: ResourceManagerColumn): Promise<void> {
    if (!positiveInteger(taskId)) throw new Error("Vikunja task ID must be a positive integer")
    const base = `/api/v1/projects/${this.options.projectId}/views/${this.options.viewId}`
    const buckets: unknown = await (await this._request(`${base}/tasks?page=1&per_page=50`)).json()
    if (!Array.isArray(buckets) || buckets.some((bucket) => !isRecord(bucket) || !positiveInteger(bucket.id) || typeof bucket.title !== "string")) {
      throw new Error("Vikunja returned invalid board columns")
    }
    const destinations = buckets.filter((bucket) => bucket.title === column)
    if (destinations.length !== 1) throw new Error(`Vikunja board must have exactly one ${column} column`)
    const bucketId: number = destinations[0].id
    await this._request(`${base}/buckets/${bucketId}/tasks`, {
      task_id: taskId, bucket_id: bucketId, project_view_id: this.options.viewId, project_id: this.options.projectId,
    })
  }
}
