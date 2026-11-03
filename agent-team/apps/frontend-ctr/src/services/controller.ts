// Run lifecycle: start, watch, wrap up, abort, finish.
// Each tick advances the run by reading the board, so a restart in the middle of a run loses nothing.
import type { SnapshotInterface } from "../interfaces/snapshot.interface.js"
import type { VikunjaTaskInterface } from "../interfaces/vikunja.interface.js"
import { Vikunja } from "./vikunja.js"
import { OpencodeWorker } from "../components/opencode-worker.js"
import { WorkerInterface } from "../interfaces/worker.interface.js"

// Logs a line prefixed with the current time.
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args)

// Turns anything thrown into a message.
const messageOf = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message
  }

  return String(err)
}

// Decides which tickets go to which agents. Each tick reads the board and hands ready tickets to idle agents.
export class Controller {
  paused = false

  // In-process mutex: stops two ticks from overlapping inside one process.
  private busy = false

  // The agents that tickets are handed to, and the Vikunja client. Both are injected so tests can pass fakes;
  // the client defaults to a new one built from config.
  constructor(
    private readonly workers: OpencodeWorker[] = [],
    private readonly vikunja: Vikunja = new Vikunja(),
  ) {}

  // State reported by status(); only the paused flag is live so far.
  private snapshot: SnapshotInterface = {
    paused: false,
    lastTick: null,
    lastError: null,
    run: null,
    queue: [],
    skipped: [],
  }

  // The current run, the ordered queue and the skipped tickets, for GET /status.
  status(): SnapshotInterface {
    return { ...this.snapshot, paused: this.paused }
  }

  // The prompt for an agent: the ticket and the branch to work on, as the agents' instructions expect.
  private taskPrompt(task: VikunjaTaskInterface): string {
    const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

    return [
      `Ticket #${task.id}: ${task.title}`,
      "",
      task.description,
      "",
      `Branch: ticket-${task.id}-${slug}`,
    ].join("\n")
  }

  // Runs one tick. Returns false when a tick was already in progress and this call was ignored.
  async tick(): Promise<boolean> {
    if (this.busy) {
      return false
    }

    this.busy = true

    try {
      this.snapshot.lastError = null

      if (this.paused) {
        return true
      }

      const freeWorkers = await this.getFreeWorkers();

    } catch (err) {
      log("tick failed:", messageOf(err))
    } finally {
      this.busy = false
    }

    return true
  }

  private async getFreeWorkers(): Promise<WorkerInterface[]> {
    const workers = []
    for (const worker of this.workers) {
      const alive = await worker.isAlive();
      const inProgress = await worker.isProgressing(worker.id);
      if (alive && !inProgress) {
        workers.push(worker)
      }
    }
    return workers;
  }
}

