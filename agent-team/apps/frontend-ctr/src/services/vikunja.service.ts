// Vikunja service bound to one project and its kanban view (config.projectId and config.viewId).
// It implements VikunjaServiceInterface, which is the only surface the rest of the controller needs.

import { config } from "../config.js"
import type { VikunjaServiceInterface } from "../interfaces/vikunja.service.interface.js"
import { vikunjaColumns } from "../interfaces/vikunja.types.js"
import type { VikunjaBucketInterface, VikunjaColumn, VikunjaTaskInterface } from "../interfaces/vikunja.types.js"

// Reads and moves tickets on the bound project's kanban board.
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
  async getTickets(column: VikunjaColumn): Promise<VikunjaTaskInterface[]> {
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
    const ready = await this.getTickets(vikunjaColumns.ready)

    // Vikunja lists blockers under related_tasks.blocked and omits related_tasks when a task has no relations,
    // so a missing field means the ticket is not blocked.
    return ready.filter((ticket) => (ticket.related_tasks?.blocked ?? []).length === 0)
  }

  // Finds the destination by title, then asks Vikunja to move the ticket into that bucket.
  async moveToColumn(ticketId: number, column: VikunjaColumn): Promise<void> {
    const buckets = await this.listBuckets()
    const bucket = buckets.find((candidate) => candidate.title.toLowerCase() === column.toLowerCase())

    if (!bucket) {
      throw new Error(`Vikunja column "${column}" does not exist`)
    }

    const path = `/projects/${this.projectId}/views/${this.viewId}/buckets/${bucket.id}/tasks`
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: ticketId,
        bucket_id: bucket.id,
        project_view_id: this.viewId,
        project_id: this.projectId,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!res.ok) {
      throw new Error(`Vikunja POST ${path} returned ${res.status}: ${await res.text()}`)
    }
  }

  // Attach one existing label, leaving all other ticket labels intact.
  async addLabel(ticketId: number, labelId: number): Promise<void> {
    const path = `/tasks/${ticketId}/labels`
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label_id: labelId }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!res.ok) {
      throw new Error(`Vikunja PUT ${path} returned ${res.status}: ${await res.text()}`)
    }
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
