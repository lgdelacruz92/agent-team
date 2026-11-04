// Vikunja service bound to one project and its kanban view (config.projectId and config.viewId).
// It implements VikunjaServiceInterface, which is the only surface the rest of the controller needs.

import { config } from "../config.js"
import type { VikunjaAPIInterface } from "../interfaces/vikunja.api.interface.js"
import type { VikunjaServiceInterface } from "../interfaces/vikunja.service.interface.js"
import { vikunjaColumns } from "../interfaces/vikunja.types.js"
import type { VikunjaBucketInterface, VikunjaColumn, VikunjaLabelInterface, VikunjaTaskInterface } from "../interfaces/vikunja.types.js"

// Reads and moves tasks on the bound project's kanban board.
export class VikunjaService implements VikunjaServiceInterface {
  constructor(
    private readonly vikunjaAPI: VikunjaAPIInterface,
    private readonly projectId: number = config.projectId,
    private readonly viewId: number = config.viewId,
    private readonly perPage: number = config.perPage,
  ) {}

  // Returns the tasks in the kanban column whose title matches `column` (case-insensitive).
  // Resolves to an empty array when the column is empty or does not exist.
  async getTasks(column: VikunjaColumn): Promise<VikunjaTaskInterface[]> {
    const buckets = await this.listBuckets()
    const wanted = column.toLowerCase()
    const tasks: VikunjaTaskInterface[] = []

    for (const bucket of buckets) {
      if (bucket.title.toLowerCase() === wanted) {
        // Vikunja sends `tasks: null` for an empty bucket, so default to an empty list.
        tasks.push(...(bucket.tasks ?? []))
      }
    }

    return tasks
  }

  // Returns the tasks in the Ready column that no other task blocks.
  async getReadyUnblockedTasks(): Promise<VikunjaTaskInterface[]> {
    const ready = await this.getTasks(vikunjaColumns.ready)

    // Vikunja lists blockers under related_tasks.blocked and omits related_tasks when a task has no relations,
    // so a missing field means the task is not blocked.
    return ready.filter((task) => (task.related_tasks?.blocked ?? []).length === 0)
  }

  // Finds the destination by title, then asks Vikunja to move the task into that bucket.
  async moveToColumn(taskId: number, column: VikunjaColumn): Promise<void> {
    const buckets = await this.listBuckets()
    const bucket = buckets.find((candidate) => candidate.title.toLowerCase() === column.toLowerCase())

    if (!bucket) {
      throw new Error(`Vikunja column "${column}" does not exist`)
    }

    const path = `/projects/${this.projectId}/views/${this.viewId}/buckets/${bucket.id}/tasks`
    const res = await this.vikunjaAPI.post(path, {
      task_id: taskId,
      bucket_id: bucket.id,
      project_view_id: this.viewId,
      project_id: this.projectId,
    })

    if (!res.ok) {
      throw new Error(`Vikunja POST ${path} returned ${res.status}: ${await res.text()}`)
    }
  }

  // Read every page of labels attached to the task through the API client.
  async getLabels(taskId: number): Promise<VikunjaLabelInterface[]> {
    const labels: VikunjaLabelInterface[] = []
    let page = 1
    let totalPages = 1

    while (page <= totalPages) {
      const path = `/tasks/${taskId}/labels?page=${page}`
      const res = await this.vikunjaAPI.get(path)

      if (!res.ok) {
        throw new Error(`Vikunja GET ${path} returned ${res.status}: ${await res.text()}`)
      }

      const result = (await res.json()) as VikunjaLabelInterface[] | null
      labels.push(...(result ?? []))
      totalPages = Number(res.headers.get("x-pagination-total-pages") ?? "1")
      page += 1
    }

    return labels
  }

  // Attach one existing label, leaving all other task labels intact.
  async addLabel(taskId: number, labelId: number): Promise<void> {
    const path = `/tasks/${taskId}/labels`
    const res = await this.vikunjaAPI.put(path, { label_id: labelId })

    if (!res.ok) {
      throw new Error(`Vikunja PUT ${path} returned ${res.status}: ${await res.text()}`)
    }
  }

  // Loads every bucket of the kanban view, each with its tasks.
  private async listBuckets(): Promise<VikunjaBucketInterface[]> {
    const path = `/projects/${this.projectId}/views/${this.viewId}/tasks?per_page=${this.perPage}`

    const res = await this.vikunjaAPI.get(path)

    if (!res.ok) {
      throw new Error(`Vikunja GET ${path} returned ${res.status}: ${await res.text()}`)
    }

    return (await res.json()) as VikunjaBucketInterface[]
  }
}
