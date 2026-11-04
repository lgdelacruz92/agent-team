// Checks task moves through the task manager's source-independent interface.
import { describe, expect, it, vi } from "vitest"
import { TaskManager } from "../src/components/task-manager.js"
import { taskColumns } from "../src/interfaces/taskmanager.interface.js"
import type { VikunjaServiceInterface } from "../src/interfaces/vikunja.service.interface.js"

describe("TaskManager.moveTo", () => {
  it("moves a task through Vikunja and propagates failures", async () => {
    const moveToColumn = vi.fn<VikunjaServiceInterface["moveToColumn"]>().mockResolvedValueOnce()
    const vikunja: VikunjaServiceInterface = {
      getTickets: async () => [],
      getReadyUnblockedTickets: async () => [],
      moveToColumn,
      addLabel: async () => {},
    }
    const manager = new TaskManager(vikunja)

    await manager.moveTo(42, taskColumns.inProgress)
    expect(moveToColumn).toHaveBeenCalledWith(42, "In progress")

    moveToColumn.mockRejectedValueOnce(new Error("column missing"))
    await expect(manager.moveTo(42, taskColumns.review)).rejects.toThrow("column missing")
    await expect(manager.moveTo("external-id", taskColumns.done)).rejects.toThrow("Vikunja task ID must be a number")
    expect(moveToColumn).toHaveBeenCalledTimes(2)
  })
})
