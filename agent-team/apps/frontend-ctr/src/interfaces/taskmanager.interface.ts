// Contract for the task manager. Callers such as the scheduler only see this, so the source of the tasks
// (Vikunja or anything else) can change without touching them.
// There is one method per kanban column in taskColumns; add a method here when a column is added there.

import type { TaskInterface } from "./task.interface.js"

// Column titles used by the scheduler, independent of the task source.
export const taskColumns = {
  ready: "Ready",
  inProgress: "In progress",
  review: "Review",
  retry: "Retry",
  done: "Done",
} as const

// A destination column accepted by the task manager.
export type TaskColumn = (typeof taskColumns)[keyof typeof taskColumns]

// Supplies and moves tasks without exposing the underlying task source.
export interface TaskManagerInterface {
  // Tasks a worker can pick up now: the unblocked tasks in Ready followed by the tasks in Retry.
  getTasks(): Promise<TaskInterface[]>

  // Tasks waiting to be started (vikunjaColumns.ready).
  getReadyTasks(): Promise<TaskInterface[]>

  // Tasks a worker is working on right now (vikunjaColumns.inProgress).
  getInProgressTasks(): Promise<TaskInterface[]>

  // Tasks whose work is finished and waiting for review (vikunjaColumns.review).
  getReviewTasks(): Promise<TaskInterface[]>

  // Tasks that failed or were sent back and should be tried again (vikunjaColumns.retry).
  getRetryTasks(): Promise<TaskInterface[]>

  // Tasks that are complete (vikunjaColumns.done).
  getDoneTasks(): Promise<TaskInterface[]>

  // Moves a task to a destination column; rejects if the task or column cannot be moved.
  moveTo(ticketId: TaskInterface["ticketId"], column: TaskColumn): Promise<void>
}
