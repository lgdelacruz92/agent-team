// Exercises worker dispatch and reuse across scheduler ticks.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TicketInterface } from "../src/interfaces/ticket.interface.js"
import { ticketColumns } from "../src/interfaces/ticketmanager.interface.js"
import type { TicketManagerInterface } from "../src/interfaces/ticketmanager.interface.js"
import type { WorkerInterface } from "../src/interfaces/worker.interface.js"
import { TicketScheduler } from "../src/services/ticket-scheduler.js"

// Scheduler tests do not convert their fake tickets back to source tasks.
const toTask = () => {
  throw new Error("not used")
}

// A worker stays busy after accepting a ticket until the test marks it available again.
const makeWorker = (id: string) => {
  let available = true
  const worker: WorkerInterface = {
    id,
    skills: [],
    isAvailable: async () => available,
    create: vi.fn(async () => {
      available = false

      return `session-${id}`
    }),
    abort: async () => {},
    delete: async () => {},
  }

  return {
    worker,
    makeAvailable: () => {
      available = true
    },
  }
}

describe("TicketScheduler", () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ticket-scheduler-"))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it("waits for busy workers and returns all available workers to the pool", async () => {
    const tickets: TicketInterface[] = [1, 2, 3, 4].map((ticketId) => ({ ticketId, title: `Ticket ${ticketId}`, description: "", getLabels: async () => [], toTask }))
    const getTickets = vi.fn(async () => tickets)
    const ticketManager: TicketManagerInterface = {
      getTickets,
      getReadyTickets: async () => [],
      getInProgressTickets: async () => [],
      getReviewTickets: async () => [],
      getRetryTickets: async () => [],
      getDoneTickets: async () => [],
      getLabels: async () => [],
      moveTo: async () => {},
    }
    const first = makeWorker("first")
    const second = makeWorker("second")
    const scheduler = new TicketScheduler(ticketManager, [first.worker, second.worker], join(directory, "sessions.json"))

    await scheduler.tick()
    await scheduler.tick()
    await scheduler.tick()

    expect(first.worker.create).toHaveBeenCalledTimes(1)
    expect(second.worker.create).toHaveBeenCalledTimes(1)
    expect(getTickets).toHaveBeenCalledTimes(2)

    first.makeAvailable()
    second.makeAvailable()
    await scheduler.tick()
    await scheduler.tick()

    expect(first.worker.create).toHaveBeenNthCalledWith(2, tickets[2])
    expect(second.worker.create).toHaveBeenNthCalledWith(2, tickets[3])
  })

  it("restores saved sessions and preserves them when another worker starts a ticket", async () => {
    const sessionsFile = join(directory, "data", "sessions.json")
    const tickets: TicketInterface[] = [1, 2].map((ticketId) => ({ ticketId, title: `Ticket ${ticketId}`, description: "", getLabels: async () => [], toTask }))
    const ticketManager: TicketManagerInterface = {
      getTickets: async () => [...tickets],
      getReadyTickets: async () => [],
      getInProgressTickets: async () => [],
      getReviewTickets: async () => [],
      getRetryTickets: async () => [],
      getDoneTickets: async () => [],
      getLabels: async () => [],
      moveTo: async (ticketId) => {
        const index = tickets.findIndex((ticket) => ticket.ticketId === ticketId)
        tickets.splice(index, 1)
      },
    }
    const first = makeWorker("first")
    const second = makeWorker("second")

    await new TicketScheduler(ticketManager, [first.worker], sessionsFile).tick()
    expect(JSON.parse(await readFile(sessionsFile, "utf8"))).toEqual({ first: "session-first" })

    await new TicketScheduler(ticketManager, [second.worker], sessionsFile).tick()
    expect(first.worker.create).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 1 }))
    expect(second.worker.create).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 2 }))
    expect(JSON.parse(await readFile(sessionsFile, "utf8"))).toEqual({
      first: "session-first",
      second: "session-second",
    })
  })

  it("rejects a malformed sessions file instead of overwriting it", async () => {
    const sessionsFile = join(directory, "sessions.json")
    await writeFile(sessionsFile, '{"first":42}')
    const ticketManager: TicketManagerInterface = {
      getTickets: async () => [],
      getReadyTickets: async () => [],
      getInProgressTickets: async () => [],
      getReviewTickets: async () => [],
      getRetryTickets: async () => [],
      getDoneTickets: async () => [],
      getLabels: async () => [],
      moveTo: async () => {},
    }

    expect(() => new TicketScheduler(ticketManager, [], sessionsFile)).toThrow("Invalid session for worker first")
    expect(await readFile(sessionsFile, "utf8")).toBe('{"first":42}')
  })

  it("retries a failed save before dispatching more work", async () => {
    const blocker = join(directory, "data")
    const sessionsFile = join(blocker, "sessions.json")
    const ticketManager: TicketManagerInterface = {
      getTickets: async () => [{ ticketId: 1, title: "Ticket 1", description: "", getLabels: async () => [], toTask }],
      getReadyTickets: async () => [],
      getInProgressTickets: async () => [],
      getReviewTickets: async () => [],
      getRetryTickets: async () => [],
      getDoneTickets: async () => [],
      getLabels: async () => [],
      moveTo: async () => {},
    }
    const first = makeWorker("first")
    const second = makeWorker("second")
    const scheduler = new TicketScheduler(ticketManager, [first.worker, second.worker], sessionsFile)
    await writeFile(blocker, "blocks directory creation")

    await scheduler.tick()
    await scheduler.tick()
    expect(second.worker.create).not.toHaveBeenCalled()

    await rm(blocker)
    scheduler.paused = true
    await scheduler.tick()
    expect(JSON.parse(await readFile(sessionsFile, "utf8"))).toEqual({ first: "session-first" })
  })

  it("retries a failed move without creating the ticket again", async () => {
    const ticket: TicketInterface = { ticketId: 1, title: "Ticket 1", description: "", getLabels: async () => [], toTask }
    const moveTo = vi.fn<TicketManagerInterface["moveTo"]>()
      .mockRejectedValueOnce(new Error("board unavailable"))
      .mockRejectedValueOnce(new Error("board unavailable"))
      .mockResolvedValue(undefined)
    const ticketManager: TicketManagerInterface = {
      getTickets: async () => [ticket],
      getReadyTickets: async () => [],
      getInProgressTickets: async () => [],
      getReviewTickets: async () => [],
      getRetryTickets: async () => [],
      getDoneTickets: async () => [],
      getLabels: async () => [],
      moveTo,
    }
    const first = makeWorker("first")
    const second = makeWorker("second")
    const scheduler = new TicketScheduler(ticketManager, [first.worker, second.worker], join(directory, "sessions.json"))

    await scheduler.tick()
    await scheduler.tick()
    expect(first.worker.create).toHaveBeenCalledTimes(1)
    expect(second.worker.create).not.toHaveBeenCalled()
    expect(moveTo).toHaveBeenCalledWith(1, ticketColumns.inProgress)

    scheduler.paused = true
    await scheduler.tick()
    expect(moveTo).toHaveBeenCalledTimes(3)
    expect(second.worker.create).not.toHaveBeenCalled()
  })

  it("does not move a ticket when starting its worker fails", async () => {
    const moveTo = vi.fn<TicketManagerInterface["moveTo"]>()
    const ticketManager: TicketManagerInterface = {
      getTickets: async () => [{ ticketId: 1, title: "Ticket 1", description: "", getLabels: async () => [], toTask }],
      getReadyTickets: async () => [],
      getInProgressTickets: async () => [],
      getReviewTickets: async () => [],
      getRetryTickets: async () => [],
      getDoneTickets: async () => [],
      getLabels: async () => [],
      moveTo,
    }
    const { worker } = makeWorker("first")
    worker.create = vi.fn().mockRejectedValue(new Error("worker unavailable"))
    const scheduler = new TicketScheduler(ticketManager, [worker], join(directory, "sessions.json"))

    await scheduler.tick()
    expect(moveTo).not.toHaveBeenCalled()
  })
})
