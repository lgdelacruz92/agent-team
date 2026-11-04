// Contract for the Vikunja service. The service is bound to a single project and its kanban view
// (config.projectId and config.viewId), so callers only need to say which column they want.

import type { VikunjaColumn, VikunjaLabelInterface, VikunjaTaskInterface } from "./vikunja.types.js"

// Reads and moves Vikunja tasks on the bound project's kanban board.
export interface VikunjaServiceInterface {
  // Returns the tasks in the kanban column whose title matches `column` (case-insensitive).
  // Resolves to an empty array when the column is empty or does not exist.
  getTasks(column: VikunjaColumn): Promise<VikunjaTaskInterface[]>

  // Returns the tasks in the Ready column that no other task blocks.
  getReadyUnblockedTasks(): Promise<VikunjaTaskInterface[]>

  // Moves a task to the column with this title (case-insensitive). Throws if the column does not exist.
  moveToColumn(taskId: number, column: VikunjaColumn): Promise<void>

  // Returns all labels attached to the task, or an empty array when it has none.
  getLabels(taskId: number): Promise<VikunjaLabelInterface[]>

  // Adds an existing label to a task without changing its other labels.
  addLabel(taskId: number, labelId: number): Promise<void>
}
