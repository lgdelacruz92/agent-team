// A worker backed by one opencode agent server. It tells the Controller whether it can take a ticket
// and starts and stops sessions on the agent. Session checks (done, stale, busy, progressing) live on the agent.
import { config } from "../config.js"
import type { OpencodeAgentInterface } from "../interfaces/opencode-agent.interface.js"
import type { TaskInterface } from "../interfaces/task.interface.js"
import type { WorkerInterface } from "../interfaces/worker.interface.js"
import { OpencodeAgent } from "../services/opencode-agent.js"
import { taskPrompt } from "./task-prompt.js"

// A worker the Controller can hand tickets to, identified by its id.
export class OpencodeWorker implements WorkerInterface {
  // The sessions this worker opened and has not deleted yet. The agent throws for an id it does not track,
  // so this is how delete() can treat a session that is already gone as deleted.
  private readonly sessionIds = new Set<string>()

  // `id` is stored on the ticket, so it has to be unique among workers and the same after a restart.
  // The agent is injected so tests can pass a fake; it defaults to a real one for this worker's id.
  constructor(
    readonly id: string = config.opencodeUser,
    readonly skills: string[] = ["react"],
    private readonly agent: OpencodeAgentInterface = new OpencodeAgent(id),
  ) {}

  // Available when the agent's server answers and it is not working. An outage or a busy agent both mean
  // "do not give it a ticket", so the Controller needs no more detail than this.
  async isAvailable(): Promise<boolean> {
    return (await this.agent.state()) === "idle"
  }

  // Opens a session, sends the ticket prompt and returns the session id to store on the ticket.
  async create(task: TaskInterface): Promise<string> {
    const session = await this.agent.createSession(`#${task.ticketId} ${task.title}`)

    this.sessionIds.add(session.id)

    await this.agent.prompt(session.id, taskPrompt(task))

    return session.id
  }

  // Stops the turn in progress. The session keeps its context.
  async abort(sessionId: string): Promise<void> {
    await this.agent.abort(sessionId)
  }

  // Deletes the session. One that is already gone counts as deleted, so the cleanup queue can retry safely.
  async delete(sessionId: string): Promise<void> {
    if (!this.sessionIds.has(sessionId)) {
      return
    }

    await this.agent.deleteSession(sessionId)

    this.sessionIds.delete(sessionId)
  }
}
