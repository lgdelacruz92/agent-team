// Defines the Vikunja operations the Resource Manager needs.

// Ticket details needed to begin work; more payload fields can be added when agreed.
export interface VikunjaTask {
  id: number
  title: string
  description: string
}

// Columns the Resource Manager is responsible for moving work into.
export type ResourceManagerColumn = "In progress" | "Done" | "Retry"

// Fetches ticket details and moves tickets on the Vikunja board.
export interface VikunjaInterface {
  // Fetch a task by its Vikunja task ID; reject if the task cannot be retrieved.
  getTask(taskId: number): Promise<VikunjaTask>

  // Move a task to the requested column; reject if the move cannot be confirmed.
  moveToColumn(taskId: number, column: ResourceManagerColumn): Promise<void>
}
