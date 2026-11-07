// Warns about unstarted assignments without changing their ownership or status.
import type { AssignmentStore } from "../db/assignment-store.js"

export class AssignmentMonitor {
  private readonly lastWarnings = new Map<number, number>()

  constructor(
    private readonly assignments: Pick<AssignmentStore, "list">,
    private readonly warningMs: number,
    private readonly warn: (message: string) => void = (message) => console.warn(message),
  ) {}

  check(now = Date.now()): void {
    const pending = this.assignments.list().filter((assignment) =>
      assignment.status === "assigned" && assignment.completedAt === null)
    const pendingIds = new Set(pending.map((assignment) => assignment.id))

    for (const id of this.lastWarnings.keys()) {
      if (!pendingIds.has(id)) this.lastWarnings.delete(id)
    }

    for (const assignment of pending) {
      const assignedAt = Date.parse(assignment.assignedAt)
      const ageMs = now - assignedAt
      if (Number.isFinite(assignedAt) && ageMs < this.warningMs) continue

      const lastWarning = this.lastWarnings.get(assignment.id)
      if (lastWarning !== undefined && now - lastWarning < this.warningMs) continue

      const details = `assignment ${assignment.id}, ticket ${assignment.ticketId}, agent ${assignment.agentId}`
      if (!Number.isFinite(assignedAt)) {
        this.warn(`${details}: invalid assigned_at; cannot determine waiting time`)
      } else {
        this.warn(`${details}: still assigned after ${Math.floor(ageMs / 1000)} seconds`)
      }
      this.lastWarnings.set(assignment.id, now)
    }
  }
}
