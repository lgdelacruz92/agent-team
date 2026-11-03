// Contract for the Vikunja service. The service is bound to a single project and its kanban view
// (config.projectId and config.viewId), so callers only need to say which column they want.

import type { VikunjaTaskInterface } from "./vikunja.types.js"

// Reads tasks from the bound project's kanban board.
export interface VikunjaServiceInterface {
  // Returns the tasks in the kanban column whose title matches `column` (case-insensitive).
  // Resolves to an empty array when the column is empty or does not exist.
  getTasks(column: string): Promise<VikunjaTaskInterface[]>
}
