// Checks ticket moves and label reads through the ticket manager's source-independent interface.
import { describe, expect, it, vi } from "vitest"
import { TicketManager } from "../src/components/ticket-manager.js"
import { ticketColumns } from "../src/interfaces/ticketmanager.interface.js"
import type { VikunjaServiceInterface } from "../src/interfaces/vikunja.service.interface.js"

describe("TicketManager.getTickets", () => {
  it("converts Vikunja tasks into tickets, with ready tickets before retries", async () => {
    const ready = { id: 1, title: "Ready", description: "First", done: false, due_date: "", labels: null }
    const retry = { id: 2, title: "Retry", description: "Second", done: false, due_date: "", labels: null }
    const getTasks = vi.fn<VikunjaServiceInterface["getTasks"]>().mockResolvedValue([retry])
    const vikunja: VikunjaServiceInterface = {
      getTasks,
      getReadyUnblockedTasks: async () => [ready],
      moveToColumn: async () => {},
      getLabels: async () => [],
      addLabel: async () => {},
    }
    const manager = new TicketManager(vikunja)

    await expect(manager.getTickets()).resolves.toEqual([
      { ticketId: 1, title: "Ready", description: "First" },
      { ticketId: 2, title: "Retry", description: "Second" },
    ])
    expect(getTasks).toHaveBeenCalledWith(ticketColumns.retry)
  })
})

describe("TicketManager.moveTo", () => {
  it("moves a ticket through Vikunja and propagates failures", async () => {
    const moveToColumn = vi.fn<VikunjaServiceInterface["moveToColumn"]>().mockResolvedValueOnce()
    const vikunja: VikunjaServiceInterface = {
      getTasks: async () => [],
      getReadyUnblockedTasks: async () => [],
      moveToColumn,
      getLabels: async () => [],
      addLabel: async () => {},
    }
    const manager = new TicketManager(vikunja)

    await manager.moveTo(42, ticketColumns.inProgress)
    expect(moveToColumn).toHaveBeenCalledWith(42, "In progress")

    moveToColumn.mockRejectedValueOnce(new Error("column missing"))
    await expect(manager.moveTo(42, ticketColumns.review)).rejects.toThrow("column missing")
    await expect(manager.moveTo("external-id", ticketColumns.done)).rejects.toThrow("Vikunja task ID must be a number")
    expect(moveToColumn).toHaveBeenCalledTimes(2)
  })
})

describe("TicketManager.getLabels", () => {
  it("returns a ticket's labels and propagates lookup failures", async () => {
    const getLabels = vi.fn<VikunjaServiceInterface["getLabels"]>()
      .mockResolvedValueOnce([{ id: 7, title: "frontend" }])
      .mockRejectedValueOnce(new Error("Vikunja unavailable"))
    const vikunja: VikunjaServiceInterface = {
      getTasks: async () => [],
      getReadyUnblockedTasks: async () => [],
      moveToColumn: async () => {},
      getLabels,
      addLabel: async () => {},
    }
    const manager = new TicketManager(vikunja)

    await expect(manager.getLabels(42)).resolves.toEqual([{ id: 7, title: "frontend" }])
    expect(getLabels).toHaveBeenCalledWith(42)
    await expect(manager.getLabels(42)).rejects.toThrow("Vikunja unavailable")
    await expect(manager.getLabels("external-id")).rejects.toThrow("Vikunja task ID must be a number")
    expect(getLabels).toHaveBeenCalledTimes(2)
  })
})
