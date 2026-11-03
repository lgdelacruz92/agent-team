// Hands ready tasks to free workers. It knows nothing about where tasks come from or what the workers are:
// it only sees TaskManagerInterface and WorkerInterface.
import type { SnapshotInterface } from "../interfaces/snapshot.interface.js"
import type { TaskManagerInterface } from "../interfaces/taskmanager.interface.js"
import type { WorkerInterface } from "../interfaces/worker.interface.js"

// Logs a line prefixed with the current time.
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args)

// Turns anything thrown into a message.
const messageOf = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message
  }

  return String(err)
}

// Each tick takes the next ready task and gives it to the first free worker.
export class TaskScheduler {
  paused = false

  // In-process mutex: stops two ticks from overlapping inside one process.
  private busy = false

  // The session each worker is running, by worker id. Needed to ask a worker whether it is still busy.
  private readonly sessions = new Map<string, string>()

  // Workers that have been given a task, checked on each tick until they are available again.
  private readonly busyWorkers: WorkerInterface[] = []
  private readonly workers: WorkerInterface[]

  // State reported by status(); only the paused flag is live so far.
  private snapshot: SnapshotInterface = {
    paused: false,
    lastTick: null,
    lastError: null,
    run: null,
    queue: [],
    skipped: [],
  }

  // Ids of tasks already handed to a worker. A task stays in the Ready column after it is dispatched (nothing moves
  // it yet), so without this the next tick would hand the same task to another worker. In memory only: a restart
  // forgets it.
  private readonly dispatched = new Set<string | number>()

  // The scheduler asks the task manager for ready tasks whenever a worker is free, so it holds no queue of its own.
  constructor(
    private readonly taskManager: TaskManagerInterface,
    workers: WorkerInterface[] = [],
  ) {
    this.workers = [...workers]
  }

  // The current run, the ordered queue and the skipped tickets, for GET /status.
  status(): SnapshotInterface {
    return { ...this.snapshot, paused: this.paused }
  }

  // Runs one tick. Returns false when a tick was already in progress and this call was ignored.
  async tick(): Promise<boolean> {
    if (this.busy) {
      return false
    }

    this.busy = true

    try {
      if (!this.paused) {
        await this.dispatchNext()
      }
    } catch (err) {
      log("tick failed:", messageOf(err))
    } finally {
      this.busy = false
    }

    return true
  }

  // Gives the next ready task to the first free worker. Does nothing when there is no task or no free worker.
  private async dispatchNext(): Promise<void> {
    // Look for a worker first, so the task source is not queried when nobody could take the task.
    const worker = await this.findFreeWorker()

    if (!worker) {
      return
    }

    const readyTasks = await this.taskManager.getTasks()
    const task = readyTasks.find((candidate) => !this.dispatched.has(candidate.id))

    if (!task) {
      return
    }

    // Remember the task only after create() succeeds, so a failed start leaves it eligible for the next tick.
    const sessionId = await worker.create(task)

    this.workers.splice(this.workers.indexOf(worker), 1)
    this.busyWorkers.push(worker)
    this.dispatched.add(task.id)
    this.sessions.set(worker.id, sessionId)

    log(`task ${task.id} -> worker ${worker.id}`)
  }

  // The first worker that is available: reachable and not working on a session.
  private async findFreeWorker(): Promise<WorkerInterface | null> {
    // Iterate over a copy so moving one worker does not skip the next busy worker.
    for (const worker of [...this.busyWorkers]) {
      if (await worker.isAvailable()) {
        this.busyWorkers.splice(this.busyWorkers.indexOf(worker), 1)
        this.workers.push(worker)
      }
    }

    for (const worker of this.workers) {
      if (await worker.isAvailable()) {
        return worker
      }
    }

    return null
  }
}
