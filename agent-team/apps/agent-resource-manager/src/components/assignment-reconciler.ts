// Turns reserved assignments into sessions and coordinates their final release.
import type { OpencodeAgentClientInterface, OpencodeState } from "../interfaces/opencode-agent-client.interface.js"
import type { Agent, Assignment, Execution, ResourceManagerDatabaseInterface, Ticket } from "../interfaces/resource-manager-database.interface.js"
import type { VikunjaInterface } from "../interfaces/vikunja.interface.js"

interface Lock {
  tryAcquire(): Promise<string | null>
  release(owner: string): Promise<void>
}

export class AssignmentReconciler {
  // Compare later activity with the session's busy time immediately before the prompt.
  private readonly locallySent = new Map<number, number | null>()

  constructor(
    private readonly database: ResourceManagerDatabaseInterface,
    private readonly vikunja: VikunjaInterface,
    private readonly lock: Lock,
    private readonly createClient: (url: string) => OpencodeAgentClientInterface,
    private readonly timeoutMs: number | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runOnce(): Promise<void> {
    const agents = new Map((await this.database.listAgents()).map((agent) => [agent.id, agent]))
    const errors: unknown[] = []
    for (const assignment of await this.database.listIncompleteAssignments()) {
      try {
        const agent = agents.get(assignment.agentId)
        const ticket = await this.database.getTicket(assignment.ticketId)
        if (!agent || !ticket) throw new Error(`Assignment ${assignment.id} has a missing agent or ticket`)
        await this.reconcile(assignment, ticket, agent)
      } catch (error) {
        console.error(`Could not reconcile assignment ${assignment.id}:`, error)
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, "One or more assignments could not be reconciled")
  }

  private async reconcile(assignment: Assignment, ticket: Ticket, agent: Agent): Promise<void> {
    let execution = await this.database.getLatestExecution(assignment.id)
    if (execution?.status === "succeeded" || (execution?.status === "failed" && execution.failureReason !== "missing session before work request")) {
      if (execution.status === "succeeded" && agent.status === "busy" && agent.url) {
        const state = await this.createClient(agent.url).state()
        if (state === "idle") await this.database.updateAgentStatus(agent.id, "idle")
        if (state === "unreachable") await this.database.updateAgentStatus(agent.id, "needs_review")
      }
      if (execution.status === "failed" && execution.sessionId && agent.url
        && (execution.failureReason === "agent unreachable" || execution.failureReason === "execution timed out")) {
        await this.tryAbort(this.createClient(agent.url), execution.sessionId)
      }
      await this.complete(assignment, ticket, execution)
      return
    }
    if (execution?.status === "failed") execution = null

    if (!agent.url) throw new Error(`Agent ${agent.id} has no URL; assignment remains reserved`)
    const client = this.createClient(agent.url)
    if (!execution) {
      // A failed fetch does not create an execution or count as an attempt.
      const task = await this.vikunja.getTask(ticket.vikunjaTaskId)
      execution = await this.database.createExecution(assignment.id, this.timestamp())
      if (agent.status === "needs_review") {
        await this.fail(execution, client, "agent needs review")
        return
      }
      const state = await client.state()
      if (state === "unreachable") {
        await this.database.updateAgentStatus(agent.id, "needs_review")
        await this.fail(execution, client, "agent unreachable")
        return
      }
      if (state !== "idle") return
      const sessionId = await client.createSession(task.title)
      await this.database.saveSession(execution.id, sessionId)
      await this.send(execution.id, sessionId, task.title, task.description, client)
      return
    }

    if (!execution.sessionId) {
      if (execution.workRequestedAt !== null) throw new Error(`Execution ${execution.id} has a recorded request but no session ID`)
      if (agent.status === "needs_review") {
        await this.fail(execution, client, "agent needs review")
        return
      }
      const state = await client.state()
      if (state === "unreachable") {
        await this.database.updateAgentStatus(agent.id, "needs_review")
        await this.fail(execution, client, "agent unreachable")
        return
      }
      if (state !== "idle") return
      const task = await this.vikunja.getTask(ticket.vikunjaTaskId)
      const sessionId = await client.createSession(task.title)
      await this.database.saveSession(execution.id, sessionId)
      await this.send(execution.id, sessionId, task.title, task.description, client)
      return
    }

    const activity = await client.sessionActivity(execution.sessionId)
    const state = activity.state
    if (state === "unreachable") {
      await this.database.updateAgentStatus(agent.id, "needs_review")
      await this.fail(execution, client, "agent unreachable")
      return
    }
    if (state === "missing") {
      if (agent.status === "busy" && await client.state() === "idle") await this.database.updateAgentStatus(agent.id, "idle")
      await this.fail(execution, client, execution.workRequestedAt ? "missing session after work request" : "missing session before work request")
      return
    }
    if (state === "unknown") return

    if (execution.workRequestedAt === null) {
      if (state === "busy") return
      if (agent.status === "needs_review") {
        await this.fail(execution, client, "agent needs review")
        return
      }
      const task = await this.vikunja.getTask(ticket.vikunjaTaskId)
      await this.send(execution.id, execution.sessionId, task.title, task.description, client)
      return
    }

    const requestedAt = Date.parse(execution.workRequestedAt)
    if (!Number.isFinite(requestedAt)) throw new Error(`Execution ${execution.id} has an invalid work request time`)
    const previousBusy = this.locallySent.get(execution.id) ?? null
    const finishedNewWork = this.locallySent.has(execution.id) && activity.busyAt !== null && activity.idleAt !== null
      && (previousBusy === null || activity.busyAt > previousBusy) && activity.idleAt >= activity.busyAt
    if (this.timeoutMs !== null && (state === "busy" || (this.locallySent.has(execution.id) && !finishedNewWork))
      && this.now().getTime() - requestedAt >= this.timeoutMs) {
      await this.database.updateAgentStatus(agent.id, "needs_review")
      await this.fail(execution, client, "execution timed out")
      return
    }

    if (state === "busy") {
      this.locallySent.delete(execution.id)
      if (execution.status === "starting") await this.database.markRunning(execution.id, this.timestamp())
      if (agent.status === "idle") await this.database.updateAgentStatus(agent.id, "busy")
      if (assignment.status !== "in_progress") {
        await this.vikunja.moveToColumn(ticket.vikunjaTaskId, "In progress")
        await this.database.updateAssignmentStatus(assignment.id, "in_progress")
      }
      return
    }

    // A new busy/idle interval can prove work happened even if both events fell between polls.
    // Older activity on a reused session does not count. Restart follows the agreed idle rule.
    if (this.locallySent.has(execution.id)) {
      if (!finishedNewWork) return
      this.locallySent.delete(execution.id)
    }

    // A session can be idle while another session on the same server is still busy.
    const agentState: OpencodeState = await client.state()
    if (agentState === "unreachable") {
      await this.database.updateAgentStatus(agent.id, "needs_review")
      await this.fail(execution, client, "agent unreachable")
    } else if (agentState === "idle") {
      await this.database.finishExecution(execution.id, "succeeded", this.timestamp(), null)
      if (agent.status === "busy") await this.database.updateAgentStatus(agent.id, "idle")
    }
  }

  private async send(id: number, sessionId: string, title: string, description: string, client: OpencodeAgentClientInterface): Promise<void> {
    const activity = await client.sessionActivity(sessionId)
    if (activity.state !== "idle") throw new Error(`Cannot send to session ${sessionId}: state is ${activity.state}`)
    console.log(`Sending work for execution ${id}, session ${sessionId}`)
    this.locallySent.set(id, activity.busyAt)
    try {
      await client.prompt(sessionId, `${title}\n\n${description}`)
    } finally {
      // Even an uncertain response counts once the request was sent and recorded.
      await this.database.recordWorkRequest(id, this.timestamp())
    }
  }

  private async fail(execution: Execution, client: OpencodeAgentClientInterface, reason: string): Promise<void> {
    await this.database.finishExecution(execution.id, "failed", this.timestamp(), reason)
    this.locallySent.delete(execution.id)
    if (execution.sessionId && reason !== "missing session before work request" && reason !== "missing session after work request") {
      await this.tryAbort(client, execution.sessionId)
    }
  }

  private async tryAbort(client: OpencodeAgentClientInterface, sessionId: string): Promise<void> {
    try { await client.abort(sessionId) } catch (error) { console.error(`Could not stop session ${sessionId}:`, error) }
  }

  private async complete(assignment: Assignment, ticket: Ticket, execution: Execution): Promise<void> {
    const owner = await this.lock.tryAcquire()
    if (!owner) return
    let completionError: unknown
    try {
      const current = await this.database.getAssignment(assignment.id)
      if (!current) throw new Error(`Assignment ${assignment.id} no longer exists`)
      if (current.completedAt !== null) return
      await this.vikunja.moveToColumn(ticket.vikunjaTaskId, execution.status === "succeeded" ? "Done" : "Retry")
      await this.database.updateAssignmentStatus(assignment.id, execution.status)
      await this.database.completeAssignment(assignment.id, this.timestamp())
    } catch (error) {
      completionError = error
      throw error
    } finally {
      try {
        await this.lock.release(owner)
      } catch (error) {
        if (completionError !== undefined) throw new AggregateError([completionError, error], "Completion and lock release failed")
        throw error
      }
    }
  }

  private timestamp(): string { return this.now().toISOString() }
}
