// Run lifecycle: start, watch, wrap up, abort, finish.
// Each tick advances the run by reading the board, so a restart in the middle of a run loses nothing.
import { Snapshot } from "../interfaces/snapshot.interface.js"
import type { OpencodeAgent } from "../interfaces/opencode-agent.interface.js"
import { Vikunja } from "./vikunja.js"

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args)

// Turns anything thrown into a message.
const messageOf = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message
  }

  return String(err)
}

export class Controller {
  paused = false

  // In-process mutex: stops two ticks from overlapping inside one process.
  private busy = false

  // The agents that tickets are handed to, and the Vikunja client. Both are injected so tests can pass fakes;
  // the client defaults to the shared one.
  constructor(
    private readonly agents: OpencodeAgent[] = [],
    private readonly vikunja: Vikunja = Vikunja.getInstance(),
  ) { }

  private snapshot: Snapshot = {
    paused: false,
    lastTick: null,
    lastError: null,
    run: null,
    queue: [],
    skipped: [],
  }

  // The current run, the ordered queue and the skipped tickets, for GET /status.
  status(): Snapshot {
    return { ...this.snapshot, paused: this.paused }
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

      const unblockedTasks = await this.vikunja.listUnblockedReadyTasks()
      console.log(unblockedTasks)
      // pass to front end

    } catch (err) {
      log("tick failed:", messageOf(err))
    } finally {
      this.busy = false
    }

    return true
  }


}
