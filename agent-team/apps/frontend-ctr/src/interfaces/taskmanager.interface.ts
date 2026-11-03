// Contract for the task manager. Callers such as the scheduler only see this, so the source of the tasks
// (Vikunja or anything else) can change without touching them.
// There is one method per kanban column in vikunjaColumns; add a method here when a column is added there.

import type { TaskInterface } from "./task.interface.js"

// Supplies the tasks sitting in each kanban column, in the order the source returns them.
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
}
