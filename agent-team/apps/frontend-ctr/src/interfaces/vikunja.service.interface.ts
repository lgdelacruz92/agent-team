// Contract for the Vikunja service. The service is bound to a single project and its kanban view
// (config.projectId and config.viewId), so callers only need to say which column they want.

import type { VikunjaColumn, VikunjaTaskInterface } from "./vikunja.types.js"

// Reads and moves tickets on the bound project's kanban board.
export interface VikunjaServiceInterface {
  // Returns the tickets in the kanban column whose title matches `column` (case-insensitive).
  // Resolves to an empty array when the column is empty or does not exist.
  getTickets(column: VikunjaColumn): Promise<VikunjaTaskInterface[]>

  // Returns the tickets in the Ready column that no other ticket blocks, so none of them is waiting on unfinished work.
  getReadyUnblockedTickets(): Promise<VikunjaTaskInterface[]>

  // Moves a ticket to the column with this title (case-insensitive). Throws if the column does not exist.
  moveToColumn(ticketId: number, column: VikunjaColumn): Promise<void>

  // Adds an existing label to a ticket without changing its other labels.
  addLabel(ticketId: number, labelId: number): Promise<void>
}
