// Hands ready tasks to free workers. It knows nothing about where tasks come from or what the workers are:
// it only sees TaskInterface and WorkerInterface.
import type { SnapshotInterface } from "../interfaces/snapshot.interface.js"
import type { TaskInterface } from "../interfaces/task.interface.js"
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

  // State reported by status(); only the paused flag is live so far.
  private snapshot: SnapshotInterface = {
    paused: false,
    lastTick: null,
    lastError: null,
    run: null,
    queue: [],
    skipped: [],
  }

  // `ready` is the queue of tasks waiting to start, oldest first. It is shared, not copied, so whoever owns the
  // array can push new tasks into it while the scheduler shifts them off.
  constructor(
    private readonly workers: WorkerInterface[] = [],
    private readonly ready: TaskInterface[] = [],
  ) {}

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
    if (!this.ready.length) {
      return
    }

    const worker = await this.findFreeWorker()

    if (!worker) {
      return
    }

    // Peek first and remove only after create() succeeds, so a failed start leaves the task queued.
    const task = this.ready[0]
    const sessionId = await worker.create(task)

    this.ready.shift()
    this.sessions.set(worker.id, sessionId)

    log(`task ${task.id} -> worker ${worker.id}`)
  }

  // The first worker that is reachable and not working on a session.
  private async findFreeWorker(): Promise<WorkerInterface | null> {
    for (const worker of this.workers) {
      if (!(await worker.isAlive())) {
        continue
      }

      const sessionId = this.sessions.get(worker.id)

      if (sessionId && (await worker.isBusy(sessionId))) {
        continue
      }

      return worker
    }

    return null
  }
}
