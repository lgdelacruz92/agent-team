// Vikunja service bound to one project and its kanban view (config.projectId and config.viewId).
// It implements VikunjaServiceInterface, which is the only surface the rest of the controller needs.

import { config } from "../config.js"
import type { VikunjaServiceInterface } from "../interfaces/vikunja.service.interface.js"
import type { VikunjaBucketInterface, VikunjaTaskInterface } from "../interfaces/vikunja.types.js"

// Reads tickets from the bound project's kanban board.
export class VikunjaService implements VikunjaServiceInterface {
  constructor(
    private readonly baseUrl: string = config.vikunjaUrl,
    private readonly token: string = config.vikunjaToken,
    private readonly timeoutMs: number = config.vikunjaTimeoutMs,
    private readonly projectId: number = config.projectId,
    private readonly viewId: number = config.viewId,
    private readonly perPage: number = config.perPage,
  ) {}

  // Returns the tickets in the kanban column whose title matches `column` (case-insensitive).
  // Resolves to an empty array when the column is empty or does not exist.
  async getTickets(column: string): Promise<VikunjaTaskInterface[]> {
    const buckets = await this.listBuckets()
    const wanted = column.toLowerCase()
    const tickets: VikunjaTaskInterface[] = []

    for (const bucket of buckets) {
      if (bucket.title.toLowerCase() === wanted) {
        // Vikunja sends `tasks: null` for an empty bucket, so default to an empty list.
        tickets.push(...(bucket.tasks ?? []))
      }
    }

    return tickets
  }

  // Returns the tickets in the Ready column that no other ticket blocks.
  async getReadyUnblockedTickets(): Promise<VikunjaTaskInterface[]> {
    const ready = await this.getTickets(config.buckets.ready)

    // Vikunja lists blockers under related_tasks.blocked and omits related_tasks when a task has no relations,
    // so a missing field means the ticket is not blocked.
    return ready.filter((ticket) => (ticket.related_tasks?.blocked ?? []).length === 0)
  }

  // Loads every bucket of the kanban view, each with its tickets.
  private async listBuckets(): Promise<VikunjaBucketInterface[]> {
    const path = `/projects/${this.projectId}/views/${this.viewId}/tasks?per_page=${this.perPage}`

    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!res.ok) {
      throw new Error(`Vikunja GET ${path} returned ${res.status}: ${await res.text()}`)
    }

    return (await res.json()) as VikunjaBucketInterface[]
  }
}
