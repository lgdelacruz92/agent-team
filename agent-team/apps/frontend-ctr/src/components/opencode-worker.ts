// A worker backed by one opencode agent server. It answers the Controller's questions about a session
// (done, stale, busy, progressing) by reading the agent, and starts and stops sessions on it.
import { config } from "../config.js"
import type { OpencodeAgentInterface } from "../interfaces/opencode-agent.interface.js"
import type { VikunjaTaskInterface } from "../interfaces/vikunja.interface.js"
import type { WorkerInterface } from "../interfaces/worker.interface.js"
import { OpencodeAgent } from "../services/opencode-agent.js"
import { taskPrompt } from "./task-prompt.js"

// How long isDone() waits for the session to go idle. Short, so one slow session cannot hold up a tick.
const idleCheckMs = 1000

// Milliseconds in a minute, to turn the configured run budget into the same unit as Date.now().
const msPerMinute = 60_000

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

  // The server answers within the time limit. "unreachable" is an outage, not a task failure.
  async isAlive(): Promise<boolean> {
    return (await this.agent.state()) !== "unreachable"
  }

  // Done when the session is idle and the last message is the agent's reply, so there is a reply to post.
  // A session that was just prompted is idle for a moment with the user's prompt as its last message: not done yet.
  async isDone(sessionId: string): Promise<boolean> {
    const idle = await this.agent.waitForIdle(sessionId, idleCheckMs)

    if (!idle) {
      return false
    }

    const messages = await this.agent.messages(sessionId)
    const last = messages[messages.length - 1]

    if (!last) {
      return false
    }

    return last.role === "assistant"
  }

  // Stale when the run has used up its budget, whatever the agent is doing. The clock starts at startedAt,
  // which the Controller stored on the ticket, so this worker keeps no clock of its own.
  async isStale(_sessionId: string, startedAt: number): Promise<boolean> {
    return Date.now() - startedAt > config.maxRunMin * msPerMinute
  }

  // The agent is working right now. The server reports this for the whole agent, which is the session's
  // state because a worker runs one ticket at a time.
  async isBusy(_sessionId: string): Promise<boolean> {
    return (await this.agent.state()) === "busy"
  }

  // Placeholder until messages carry a timestamp: always progressing, so a stuck session is caught by isStale()
  // at the end of its budget instead. Replace with "newest message is younger than the threshold".
  async isProgressing(_sessionId: string): Promise<boolean> {
    return true
  }

  // Opens a session, sends the ticket prompt and returns the session id to store on the ticket.
  async create(task: VikunjaTaskInterface): Promise<string> {
    const session = await this.agent.createSession(`#${task.id} ${task.title}`)

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
