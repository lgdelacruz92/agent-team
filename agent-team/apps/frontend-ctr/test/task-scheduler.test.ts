// Exercises worker dispatch and reuse across scheduler ticks.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TaskInterface } from "../src/interfaces/task.interface.js"
import { taskColumns } from "../src/interfaces/taskmanager.interface.js"
import type { TaskManagerInterface } from "../src/interfaces/taskmanager.interface.js"
import type { WorkerInterface } from "../src/interfaces/worker.interface.js"
import { TaskScheduler } from "../src/services/task-scheduler.js"

// A worker stays busy after accepting a task until the test marks it available again.
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

describe("TaskScheduler", () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "task-scheduler-"))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it("waits for busy workers and returns all available workers to the pool", async () => {
    const tasks: TaskInterface[] = [1, 2, 3, 4].map((ticketId) => ({ ticketId, title: `Task ${ticketId}`, description: "" }))
    const getTasks = vi.fn(async () => tasks)
    const taskManager: TaskManagerInterface = {
      getTasks,
      getReadyTasks: async () => [],
      getInProgressTasks: async () => [],
      getReviewTasks: async () => [],
      getRetryTasks: async () => [],
      getDoneTasks: async () => [],
      moveTo: async () => {},
    }
    const first = makeWorker("first")
    const second = makeWorker("second")
    const scheduler = new TaskScheduler(taskManager, [first.worker, second.worker], join(directory, "sessions.json"))

    await scheduler.tick()
    await scheduler.tick()
    await scheduler.tick()

    expect(first.worker.create).toHaveBeenCalledTimes(1)
    expect(second.worker.create).toHaveBeenCalledTimes(1)
    expect(getTasks).toHaveBeenCalledTimes(2)

    first.makeAvailable()
    second.makeAvailable()
    await scheduler.tick()
    await scheduler.tick()

    expect(first.worker.create).toHaveBeenNthCalledWith(2, tasks[2])
    expect(second.worker.create).toHaveBeenNthCalledWith(2, tasks[3])
  })

  it("restores saved sessions and preserves them when another worker starts a task", async () => {
    const sessionsFile = join(directory, "data", "sessions.json")
    const tasks: TaskInterface[] = [1, 2].map((ticketId) => ({ ticketId, title: `Task ${ticketId}`, description: "" }))
    const taskManager: TaskManagerInterface = {
      getTasks: async () => [...tasks],
      getReadyTasks: async () => [],
      getInProgressTasks: async () => [],
      getReviewTasks: async () => [],
      getRetryTasks: async () => [],
      getDoneTasks: async () => [],
      moveTo: async (ticketId) => {
        const index = tasks.findIndex((task) => task.ticketId === ticketId)
        tasks.splice(index, 1)
      },
    }
    const first = makeWorker("first")
    const second = makeWorker("second")

    await new TaskScheduler(taskManager, [first.worker], sessionsFile).tick()
    expect(JSON.parse(await readFile(sessionsFile, "utf8"))).toEqual({ first: "session-first" })

    await new TaskScheduler(taskManager, [second.worker], sessionsFile).tick()
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
    const taskManager: TaskManagerInterface = {
      getTasks: async () => [],
      getReadyTasks: async () => [],
      getInProgressTasks: async () => [],
      getReviewTasks: async () => [],
      getRetryTasks: async () => [],
      getDoneTasks: async () => [],
      moveTo: async () => {},
    }

    expect(() => new TaskScheduler(taskManager, [], sessionsFile)).toThrow("Invalid session for worker first")
    expect(await readFile(sessionsFile, "utf8")).toBe('{"first":42}')
  })

  it("retries a failed save before dispatching more work", async () => {
    const blocker = join(directory, "data")
    const sessionsFile = join(blocker, "sessions.json")
    const taskManager: TaskManagerInterface = {
      getTasks: async () => [{ ticketId: 1, title: "Task 1", description: "" }],
      getReadyTasks: async () => [],
      getInProgressTasks: async () => [],
      getReviewTasks: async () => [],
      getRetryTasks: async () => [],
      getDoneTasks: async () => [],
      moveTo: async () => {},
    }
    const first = makeWorker("first")
    const second = makeWorker("second")
    const scheduler = new TaskScheduler(taskManager, [first.worker, second.worker], sessionsFile)
    await writeFile(blocker, "blocks directory creation")

    await scheduler.tick()
    await scheduler.tick()
    expect(second.worker.create).not.toHaveBeenCalled()

    await rm(blocker)
    scheduler.paused = true
    await scheduler.tick()
    expect(JSON.parse(await readFile(sessionsFile, "utf8"))).toEqual({ first: "session-first" })
  })

  it("retries a failed move without creating the task again", async () => {
    const task: TaskInterface = { ticketId: 1, title: "Task 1", description: "" }
    const moveTo = vi.fn<TaskManagerInterface["moveTo"]>()
      .mockRejectedValueOnce(new Error("board unavailable"))
      .mockRejectedValueOnce(new Error("board unavailable"))
      .mockResolvedValue(undefined)
    const taskManager: TaskManagerInterface = {
      getTasks: async () => [task],
      getReadyTasks: async () => [],
      getInProgressTasks: async () => [],
      getReviewTasks: async () => [],
      getRetryTasks: async () => [],
      getDoneTasks: async () => [],
      moveTo,
    }
    const first = makeWorker("first")
    const second = makeWorker("second")
    const scheduler = new TaskScheduler(taskManager, [first.worker, second.worker], join(directory, "sessions.json"))

    await scheduler.tick()
    await scheduler.tick()
    expect(first.worker.create).toHaveBeenCalledTimes(1)
    expect(second.worker.create).not.toHaveBeenCalled()
    expect(moveTo).toHaveBeenCalledWith(1, taskColumns.inProgress)

    scheduler.paused = true
    await scheduler.tick()
    expect(moveTo).toHaveBeenCalledTimes(3)
    expect(second.worker.create).not.toHaveBeenCalled()
  })

  it("does not move a task when starting its worker fails", async () => {
    const moveTo = vi.fn<TaskManagerInterface["moveTo"]>()
    const taskManager: TaskManagerInterface = {
      getTasks: async () => [{ ticketId: 1, title: "Task 1", description: "" }],
      getReadyTasks: async () => [],
      getInProgressTasks: async () => [],
      getReviewTasks: async () => [],
      getRetryTasks: async () => [],
      getDoneTasks: async () => [],
      moveTo,
    }
    const { worker } = makeWorker("first")
    worker.create = vi.fn().mockRejectedValue(new Error("worker unavailable"))
    const scheduler = new TaskScheduler(taskManager, [worker], join(directory, "sessions.json"))

    await scheduler.tick()
    expect(moveTo).not.toHaveBeenCalled()
  })
})
