// Contract for a worker the Controller schedules tickets onto. The Controller only talks to workers through
// this, so adding a worker is a config change and the scheduling code does not change.
import type { VikunjaTaskInterface } from "./vikunja.interface.js"

// A worker the Controller can start a ticket on, watch while it runs and clean up after.
// One worker runs one ticket at a time, so a session id is enough to address its work.
export interface WorkerInterface {
  // Unique name, such as "frontend-1". Stored on the ticket so the Controller finds the worker again after a restart.
  readonly id: string

  // What this worker can do. Matched against what a ticket needs when picking a free worker.
  readonly skills: string[]

  // True when the worker's server answers within the time limit. False means an outage, not a task failure.
  isAlive(): Promise<boolean>

  // True when the session is idle and the agent has answered the prompt, so its reply is ready to post.
  isDone(sessionId: string): Promise<boolean>

  // True when the run has used up its time budget, counted from startedAt (epoch milliseconds),
  // whatever the agent is doing. startedAt comes from the ticket, so the worker holds no clock of its own.
  isStale(sessionId: string, startedAt: number): Promise<boolean>

  // True when the session is working right now. False for a session that has not started yet.
  isBusy(sessionId: string): Promise<boolean>

  // True when the session produced something recently, judged from the time of its newest message.
  // Only meaningful while the session is busy: a busy session that is not progressing is stuck.
  isProgressing(sessionId: string): Promise<boolean>

  // Opens a session for the ticket, sends its prompt and returns the session id to store on the ticket.
  create(task: VikunjaTaskInterface): Promise<string>

  // Stops the turn in progress. The session keeps its context.
  abort(sessionId: string): Promise<void>

  // Deletes the session. A session that is already gone counts as deleted.
  delete(sessionId: string): Promise<void>
}
