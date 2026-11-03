// Exercises worker dispatch and reuse across scheduler ticks.
import { describe, expect, it, vi } from "vitest"
import type { TaskInterface } from "../src/interfaces/task.interface.js"
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
    }
    const first = makeWorker("first")
    const second = makeWorker("second")
    const scheduler = new TaskScheduler(taskManager, [first.worker, second.worker])

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
})
