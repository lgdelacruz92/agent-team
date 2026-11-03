// Contract for the task manager. Callers such as the scheduler only see this, so the source of the tasks
// (Vikunja or anything else) can change without touching them.
// There is one method per kanban column in config.buckets; add a method here when a bucket is added there.

import type { TaskInterface } from "./task.interface.js"

// Supplies the tasks sitting in each kanban column, in the order the source returns them.
export interface TaskManagerInterface {
  // Tasks waiting to be started (config.buckets.ready).
  getReadyTasks(): Promise<TaskInterface[]>

  // Tasks a worker is working on right now (config.buckets.inProgress).
  getInProgressTasks(): Promise<TaskInterface[]>

  // Tasks whose work is finished and waiting for review (config.buckets.review).
  getReviewTasks(): Promise<TaskInterface[]>

  // Tasks that failed or were sent back and should be tried again (config.buckets.retry).
  getRetryTasks(): Promise<TaskInterface[]>

  // Tasks that are complete (config.buckets.done).
  getDoneTasks(): Promise<TaskInterface[]>
}
