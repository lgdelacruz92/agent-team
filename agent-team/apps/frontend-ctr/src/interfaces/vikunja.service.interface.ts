// Contract for the Vikunja service. The service is bound to a single project and its kanban view
// (config.projectId and config.viewId), so callers only need to say which column they want.

import type { VikunjaTaskInterface } from "./vikunja.types.js"

// Reads tickets from the bound project's kanban board.
export interface VikunjaServiceInterface {
  // Returns the tickets in the kanban column whose title matches `column` (case-insensitive).
  // Resolves to an empty array when the column is empty or does not exist.
  getTickets(column: string): Promise<VikunjaTaskInterface[]>

  // Returns the tickets in the Ready column that no other ticket blocks, so none of them is waiting on unfinished work.
  getReadyUnblockedTickets(): Promise<VikunjaTaskInterface[]>
}
