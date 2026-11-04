// Hands ready tickets to free workers. It knows nothing about where tickets come from or what the workers are:
// it only sees TicketManagerInterface and WorkerInterface.
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { config } from "../config.js"
import type { SnapshotInterface } from "../interfaces/snapshot.interface.js"
import { ticketColumns } from "../interfaces/ticketmanager.interface.js"
import type { TicketManagerInterface } from "../interfaces/ticketmanager.interface.js"
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

// Each tick takes the next ready ticket and gives it to the first free worker.
export class TicketScheduler {
  paused = false

  // In-process mutex: stops two ticks from overlapping inside one process.
  private busy = false

  // The latest session assigned to each worker, restored from disk after a restart.
  private readonly sessions = new Map<string, string>()
  private sessionsDirty = false

  // Workers that have been given a ticket, checked on each tick until they are available again.
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

  // Avoid handing the same ticket to another worker while its board move is pending or the ticket list is stale.
  private readonly dispatched = new Set<string | number>()
  private readonly pendingMoves = new Set<string | number>()

  // The scheduler asks the ticket manager for ready tickets whenever a worker is free, so it holds no queue of its own.
  constructor(
    private readonly ticketManager: TicketManagerInterface,
    workers: WorkerInterface[] = [],
    private readonly sessionsFile: string = config.sessionsFile,
  ) {
    this.workers = [...workers]
    this.loadSessions()
  }

  // An absent file means a fresh start; malformed or unreadable files must not be silently overwritten.
  private loadSessions(): void {
    let contents: string

    try {
      contents = readFileSync(this.sessionsFile, "utf8")
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        return
      }

      throw err
    }

    const saved: unknown = JSON.parse(contents)

    if (saved === null || typeof saved !== "object" || Array.isArray(saved)) {
      throw new Error(`Invalid sessions file: ${this.sessionsFile}`)
    }

    for (const [workerId, sessionId] of Object.entries(saved)) {
      if (typeof sessionId !== "string") {
        throw new Error(`Invalid session for worker ${workerId} in ${this.sessionsFile}`)
      }

      this.sessions.set(workerId, sessionId)
    }
  }

  // Write beside the destination and rename, so a stopped process cannot leave a half-written JSON file.
  private async saveSessions(): Promise<void> {
    await mkdir(dirname(this.sessionsFile), { recursive: true })
    const temporaryFile = `${this.sessionsFile}.${randomUUID()}.tmp`

    try {
      await writeFile(temporaryFile, JSON.stringify(Object.fromEntries(this.sessions), null, 2) + "\n")
      await rename(temporaryFile, this.sessionsFile)
      this.sessionsDirty = false
    } finally {
      await rm(temporaryFile, { force: true })
    }
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
      // Retry a failed save before starting more work, even when the scheduler is paused.
      if (this.sessionsDirty) {
        await this.saveSessions()
      }

      // Finish a failed board update before handing out more work, even when paused.
      await this.movePendingTickets()

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

  // Gives the next ready ticket to the first free worker. Does nothing when there is no ticket or no free worker.
  private async dispatchNext(): Promise<void> {
    // Look for a worker first, so the ticket source is not queried when nobody could take the ticket.
    const worker = await this.findFreeWorker()

    if (!worker) {
      return
    }

    // Find ready tickets
    // ready means unblocked, in ready, or retry column
    const readyTickets = await this.ticketManager.getTickets()

    // Check the dispatched array if ticket has already been dispatched
    const ticket = readyTickets.find((candidate) => !this.dispatched.has(candidate.ticketId))

    // no ready tickets continue
    if (!ticket) {
      return
    }

    // Remember the ticket only after create() succeeds, so a failed start leaves it eligible for the next tick.
    const sessionId = await worker.create(ticket)

    // remove the worker from the available worker. This means worker is working on the ticket
    this.workers.splice(this.workers.indexOf(worker), 1)

    // Add the worker into busy workers list
    this.busyWorkers.push(worker)

    // Record that the ticket has been dispatched
    this.dispatched.add(ticket.ticketId)

    // Make it a pending move incase interruption happens we can come back to where we left off
    this.pendingMoves.add(ticket.ticketId)

    // Keep a record of worker.id and session id association
    this.sessions.set(worker.id, sessionId)

    // Preparing a change in persistent session record
    this.sessionsDirty = true

    // Save the session. If this fails this.sessionDirty is still true and we
    // have a change to try later
    await this.saveSessions()

    // When sessions are save we can move ticket
    await this.movePendingTickets()

    log(`ticket ${ticket.ticketId} -> worker ${worker.id}`)
  }

  // Keep a failed move pending so a later tick can retry without starting the ticket again.
  private async movePendingTickets(): Promise<void> {
    for (const ticketId of this.pendingMoves) {
      await this.ticketManager.moveTo(ticketId, ticketColumns.inProgress)
      this.pendingMoves.delete(ticketId)
    }
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
