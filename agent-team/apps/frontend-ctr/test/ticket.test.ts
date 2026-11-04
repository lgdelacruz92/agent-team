// Checks that ticket conversion preserves task fields and label lookup stays current.
import { describe, expect, it, vi } from "vitest"
import { Ticket } from "../src/components/ticket.js"
import type { VikunjaServiceInterface } from "../src/interfaces/vikunja.service.interface.js"
import type { VikunjaTaskInterface } from "../src/interfaces/vikunja.types.js"

describe("Ticket", () => {
  it("round-trips task fields and fetches labels on demand", async () => {
    const blocker: VikunjaTaskInterface = {
      id: 9, title: "Blocker", description: "", done: false, due_date: "", labels: null,
    }
    const task: VikunjaTaskInterface = {
      id: 42,
      title: "Ticket",
      description: "Details",
      done: true,
      due_date: "2026-01-01",
      labels: [{ id: 1, title: "old" }],
      related_tasks: { blocked: [blocker] },
    }
    const getLabels = vi.fn<VikunjaServiceInterface["getLabels"]>().mockResolvedValue([{ id: 2, title: "current" }])
    const vikunja: VikunjaServiceInterface = {
      getTasks: async () => [],
      getReadyUnblockedTasks: async () => [],
      moveToColumn: async () => {},
      getLabels,
      addLabel: async () => {},
    }

    const ticket = Ticket.fromTask(task, vikunja)

    expect(ticket.ticketId).toBe(42)
    expect(ticket.title).toBe("Ticket")
    expect(ticket.description).toBe("Details")
    expect(ticket.toTask()).toEqual(task)
    expect(ticket.toTask()).not.toBe(task)
    expect(getLabels).not.toHaveBeenCalled()
    await expect(ticket.getLabels()).resolves.toEqual([{ id: 2, title: "current" }])
    expect(getLabels).toHaveBeenCalledWith(42)
    expect(ticket.toTask().labels).toEqual([{ id: 1, title: "old" }])
  })
})
