// Reads tickets from one existing Vikunja Kanban board.
import type { VikunjaInterface, VikunjaTicket } from "../interfaces/vikunja.interface.js"

export interface VikunjaOptions {
  baseUrl: string
  token: string
  projectId: number
  viewId: number
  perPage?: number
  timeoutMs?: number
}

interface KanbanTask {
  id: number
  title: string
  priority: number
}

interface KanbanBucket {
  id: number
  title: string
  count: number
  tasks: KanbanTask[] | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

// Check the fields we use rather than trusting a TypeScript cast of external JSON.
function readBuckets(value: unknown): KanbanBucket[] {
  if (!Array.isArray(value)) {
    throw new Error("Vikunja response must be a Kanban bucket array")
  }

  return value.map((bucket) => {
    if (!isObject(bucket) || !isPositiveInteger(bucket.id) || typeof bucket.title !== "string"
      || typeof bucket.count !== "number" || !Number.isSafeInteger(bucket.count) || bucket.count < 0
      || (bucket.tasks !== null && !Array.isArray(bucket.tasks))) {
      throw new Error("Vikunja response contains an invalid Kanban bucket")
    }

    const tasks = bucket.tasks === null ? null : (bucket.tasks as unknown[]).map((task) => {
      if (!isObject(task) || !isPositiveInteger(task.id) || typeof task.title !== "string"
        || typeof task.priority !== "number" || !Number.isSafeInteger(task.priority)) {
        throw new Error("Vikunja response contains an invalid task")
      }

      return { id: task.id, title: task.title, priority: task.priority }
    })

    return { id: bucket.id, title: bucket.title, count: bucket.count, tasks }
  })
}

// Reads board tickets and moves assigned cards to the exact In progress column.
export class Vikunja implements VikunjaInterface {
  private readonly baseUrl: string
  private readonly perPage: number
  private readonly timeoutMs: number

  constructor(
    private readonly options: VikunjaOptions,
    private readonly fetchRequest: typeof fetch = fetch,
  ) {
    const url = new URL(options.baseUrl)
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.search || url.hash || url.username || url.password) {
      throw new Error("Vikunja baseUrl must be an HTTP or HTTPS URL without credentials, query, or fragment")
    }
    if (!options.token.trim()) {
      throw new Error("Vikunja token is required")
    }

    this.baseUrl = url.toString().replace(/\/+$/, "")
    this.perPage = options.perPage ?? 50
    this.timeoutMs = options.timeoutMs ?? 30_000

    for (const [name, value] of Object.entries({
      projectId: options.projectId,
      viewId: options.viewId,
      perPage: this.perPage,
      timeoutMs: this.timeoutMs,
    })) {
      if (!isPositiveInteger(value)) {
        throw new Error(`Vikunja ${name} must be a positive safe integer`)
      }
    }
  }

  // Column titles are the statuses; no readiness filtering or database writes happen here.
  async getTickets(): Promise<VikunjaTicket[]> {
    const tickets = new Map<number, VikunjaTicket>()
    const seenByBucket = new Map<number, Set<number>>()
    let page = 1

    while (true) {
      const buckets = await this.getPage(page)
      let hasMore = false
      let newCards = 0

      for (const bucket of buckets) {
        const seen = seenByBucket.get(bucket.id) ?? new Set<number>()
        seenByBucket.set(bucket.id, seen)

        for (const task of bucket.tasks ?? []) {
          if (!seen.has(task.id)) {
            seen.add(task.id)
            newCards += 1
          }

          tickets.set(task.id, {
            vikunjaTaskId: task.id,
            title: task.title,
            status: bucket.title,
            priority: task.priority,
          })
        }

        if (seen.size < bucket.count) {
          hasMore = true
        }
      }

      if (!hasMore) {
        return [...tickets.values()]
      }
      if (newCards === 0) {
        throw new Error("Vikunja pagination stopped before all Kanban cards were returned")
      }

      page += 1
    }
  }

  async markInProgress(vikunjaTaskId: number): Promise<void> {
    if (!isPositiveInteger(vikunjaTaskId)) {
      throw new Error("Vikunja task ID must be a positive safe integer")
    }

    // Every column is included on the first card page, even when its tasks are empty.
    const buckets = await this.getPage(1)
    const destinations = buckets.filter((bucket) => bucket.title === "In progress")

    if (destinations.length !== 1) {
      throw new Error('Vikunja board must have exactly one "In progress" column')
    }

    const bucket = destinations[0]
    const path = `/api/v1/projects/${this.options.projectId}/views/${this.options.viewId}/buckets/${bucket.id}/tasks`
    const response = await this.fetchRequest(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task_id: vikunjaTaskId,
        bucket_id: bucket.id,
        project_view_id: this.options.viewId,
        project_id: this.options.projectId,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      throw new Error(`Vikunja POST ${path} returned HTTP ${response.status}`)
    }
  }

  private async getPage(page: number): Promise<KanbanBucket[]> {
    const path = `/api/v1/projects/${this.options.projectId}/views/${this.options.viewId}/tasks`
    const url = `${this.baseUrl}${path}?page=${page}&per_page=${this.perPage}`
    const response = await this.fetchRequest(url, {
      headers: { Authorization: `Bearer ${this.options.token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      throw new Error(`Vikunja GET ${path} page ${page} returned HTTP ${response.status}`)
    }

    return readBuckets(await response.json())
  }
}
