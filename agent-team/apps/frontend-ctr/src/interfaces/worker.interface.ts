// Contract for a worker the scheduler schedules tickets onto. The Controller only talks to workers through
// this, so adding a worker is a config change and the scheduling code does not change.
import type { TaskInterface } from "./task.interface.js"

// A worker the scheduler can start a ticket on, watch while it runs and clean up after.
// One worker runs one ticket at a time, so a session id is enough to address its work.
export interface WorkerInterface {
  // Unique name, such as "frontend-1". Stored on the ticket so the scheduler finds the worker again after a restart.
  readonly id: string

  // What this worker can do. Matched against what a ticket needs when picking a free worker.
  readonly skills: string[]

  // True when the worker can take a new ticket now: its server answers and it is not working on a session.
  // False covers both an outage and a busy worker; the scheduler only needs to know whether to skip it.
  isAvailable(): Promise<boolean>

  // Opens a session for the ticket, sends its prompt and returns the session id to store on the ticket.
  create(task: TaskInterface): Promise<string>

  // Stops the turn in progress. The session keeps its context.
  abort(sessionId: string): Promise<void>

  // Deletes the session. A session that is already gone counts as deleted.
  delete(sessionId: string): Promise<void>
}
