// Turns reserved assignments into sessions and coordinates their final release.
import type { OpencodeAgentClientInterface, OpencodeSessionActivity } from "../interfaces/opencode-agent-client.interface.js"
import type { Agent, Assignment, Execution, ResourceManagerDatabaseInterface, Ticket } from "../interfaces/resource-manager-database.interface.js"
import type { VikunjaInterface, VikunjaTask } from "../interfaces/vikunja.interface.js"

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
        await this._reconcile(assignment, ticket, agent)
      } catch (error) {
        console.error(`Could not reconcile assignment ${assignment.id}:`, error)
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, "One or more assignments could not be reconciled")
  }

  private async _reconcile(assignment: Assignment, ticket: Ticket, agent: Agent): Promise<void> {
    let execution = await this.database.getLatestExecution(assignment.id)
    if (await this._handleFinishedExecution(assignment, ticket, agent, execution)) return
    if (execution?.status === "failed") execution = null

    if (!agent.url) throw new Error(`Agent ${agent.id} has no URL; assignment remains reserved`)
    const client = this.createClient(agent.url)
    if (!execution) {
      await this._startExecution(assignment, ticket, agent, client)
      return
    }
    if (!execution.sessionId) {
      await this._recoverExecutionWithoutSession(execution, ticket, agent, client)
      return
    }
    await this._reconcileSession(assignment, ticket, agent, execution, execution.sessionId, client)
  }

  private async _startExecution(assignment: Assignment, ticket: Ticket, agent: Agent, client: OpencodeAgentClientInterface): Promise<void> {
    // A failed fetch does not create an execution or count as an attempt.
    const task = await this.vikunja.getTask(ticket.vikunjaTaskId)
    const execution = await this.database.createExecution(assignment.id, this._timestamp())
    if (await this._agentReadyForSession(agent, execution, client)) await this._createSessionAndSend(execution, task, client)
  }

  private async _recoverExecutionWithoutSession(execution: Execution, ticket: Ticket, agent: Agent, client: OpencodeAgentClientInterface): Promise<void> {
    if (execution.workRequestedAt !== null) throw new Error(`Execution ${execution.id} has a recorded request but no session ID`)
    if (!await this._agentReadyForSession(agent, execution, client)) return
    const task = await this.vikunja.getTask(ticket.vikunjaTaskId)
    await this._createSessionAndSend(execution, task, client)
  }

  private async _agentReadyForSession(agent: Agent, execution: Execution, client: OpencodeAgentClientInterface): Promise<boolean> {
    if (agent.status === "needs_review") {
      await this._fail(execution, client, "agent needs review")
      return false
    }
    const state = await client.state()
    if (state === "unreachable") await this._failUnreachableAgent(agent, execution, client)
    return state === "idle"
  }

  private async _createSessionAndSend(execution: Execution, task: VikunjaTask, client: OpencodeAgentClientInterface): Promise<void> {
    const sessionId = await client.createSession(task.title)
    await this.database.saveSession(execution.id, sessionId)
    await this._send(execution.id, sessionId, task.title, task.description, client)
  }

  private async _reconcileSession(assignment: Assignment, ticket: Ticket, agent: Agent, execution: Execution, sessionId: string, client: OpencodeAgentClientInterface): Promise<void> {
    const activity = await client.sessionActivity(sessionId)
    const state = activity.state
    if (state === "unreachable") {
      await this._failUnreachableAgent(agent, execution, client)
      return
    }
    if (state === "missing") {
      await this._handleMissingSession(agent, execution, client)
      return
    }
    if (state === "unknown") return
    if (execution.workRequestedAt === null) {
      if (state === "idle") await this._sendPendingWork(ticket, agent, execution, sessionId, client)
      return
    }
    await this._monitorRequestedWork(assignment, ticket, agent, execution, activity, client)
  }

  private async _handleMissingSession(agent: Agent, execution: Execution, client: OpencodeAgentClientInterface): Promise<void> {
    if (agent.status === "busy" && await client.state() === "idle") await this.database.updateAgentStatus(agent.id, "idle")
    const reason = execution.workRequestedAt ? "missing session after work request" : "missing session before work request"
    await this._fail(execution, client, reason)
  }

  private async _sendPendingWork(ticket: Ticket, agent: Agent, execution: Execution, sessionId: string, client: OpencodeAgentClientInterface): Promise<void> {
    if (agent.status === "needs_review") {
      await this._fail(execution, client, "agent needs review")
      return
    }
    const task = await this.vikunja.getTask(ticket.vikunjaTaskId)
    await this._send(execution.id, sessionId, task.title, task.description, client)
  }

  private async _monitorRequestedWork(assignment: Assignment, ticket: Ticket, agent: Agent, execution: Execution, activity: OpencodeSessionActivity, client: OpencodeAgentClientInterface): Promise<void> {
    const requestedAt = Date.parse(execution.workRequestedAt ?? "")
    if (!Number.isFinite(requestedAt)) throw new Error(`Execution ${execution.id} has an invalid work request time`)
    const finishedNewWork = this._hasFinishedNewWork(execution.id, activity)
    if (this.timeoutMs !== null && (activity.state === "busy" || (this.locallySent.has(execution.id) && !finishedNewWork))
      && this.now().getTime() - requestedAt >= this.timeoutMs) {
      await this.database.updateAgentStatus(agent.id, "needs_review")
      await this._fail(execution, client, "execution timed out")
      return
    }
    if (activity.state === "busy") {
      await this._markWorkInProgress(assignment, ticket, agent, execution)
      return
    }
    if (this.locallySent.has(execution.id)) {
      if (!finishedNewWork) return
      this.locallySent.delete(execution.id)
    }
    // After a restart there is no local baseline; the agreed rule accepts idle and ready.
    await this._finishIfAgentIdle(agent, execution, client)
  }

  private _hasFinishedNewWork(executionId: number, activity: OpencodeSessionActivity): boolean {
    // A newer busy/idle interval proves work happened between polls; old activity does not.
    const previousBusy = this.locallySent.get(executionId) ?? null
    return this.locallySent.has(executionId) && activity.busyAt !== null && activity.idleAt !== null
      && (previousBusy === null || activity.busyAt > previousBusy) && activity.idleAt >= activity.busyAt
  }

  private async _markWorkInProgress(assignment: Assignment, ticket: Ticket, agent: Agent, execution: Execution): Promise<void> {
    this.locallySent.delete(execution.id)
    if (execution.status === "starting") await this.database.markRunning(execution.id, this._timestamp())
    if (agent.status === "idle") await this.database.updateAgentStatus(agent.id, "busy")
    if (assignment.status !== "in_progress") {
      await this.vikunja.moveToColumn(ticket.vikunjaTaskId, "In progress")
      await this.database.updateAssignmentStatus(assignment.id, "in_progress")
    }
  }

  private async _finishIfAgentIdle(agent: Agent, execution: Execution, client: OpencodeAgentClientInterface): Promise<void> {
    // A session can be idle while another session on the same server is still busy.
    const agentState = await client.state()
    if (agentState === "unreachable") {
      await this._failUnreachableAgent(agent, execution, client)
    } else if (agentState === "idle") {
      await this.database.finishExecution(execution.id, "succeeded", this._timestamp(), null)
      if (agent.status === "busy") await this.database.updateAgentStatus(agent.id, "idle")
    }
  }

  private async _failUnreachableAgent(agent: Agent, execution: Execution, client: OpencodeAgentClientInterface): Promise<void> {
    await this.database.updateAgentStatus(agent.id, "needs_review")
    await this._fail(execution, client, "agent unreachable")
  }

  private async _handleFinishedExecution(assignment: Assignment, ticket: Ticket, agent: Agent, execution: Execution | null): Promise<boolean> {
    if (!execution) return false
    if (execution.status === "failed" && execution.failureReason === "missing session before work request") return false
    if (execution.status !== "succeeded" && execution.status !== "failed") return false

    if (execution.status === "succeeded" && agent.status === "busy" && agent.url) {
      const state = await this.createClient(agent.url).state()
      if (state === "idle") await this.database.updateAgentStatus(agent.id, "idle")
      if (state === "unreachable") await this.database.updateAgentStatus(agent.id, "needs_review")
    }
    if (execution.status === "failed" && execution.sessionId && agent.url
      && (execution.failureReason === "agent unreachable" || execution.failureReason === "execution timed out")) {
      await this._tryAbort(this.createClient(agent.url), execution.sessionId)
    }
    await this._complete(assignment, ticket, execution)
    return true
  }

  private async _send(id: number, sessionId: string, title: string, description: string, client: OpencodeAgentClientInterface): Promise<void> {
    const activity = await client.sessionActivity(sessionId)
    if (activity.state !== "idle") throw new Error(`Cannot send to session ${sessionId}: state is ${activity.state}`)
    console.log(`Sending work for execution ${id}, session ${sessionId}`)
    this.locallySent.set(id, activity.busyAt)
    try {
      await client.prompt(sessionId, `${title}\n\n${description}`)
    } finally {
      // Even an uncertain response counts once the request was sent and recorded.
      await this.database.recordWorkRequest(id, this._timestamp())
    }
  }

  private async _fail(execution: Execution, client: OpencodeAgentClientInterface, reason: string): Promise<void> {
    await this.database.finishExecution(execution.id, "failed", this._timestamp(), reason)
    this.locallySent.delete(execution.id)
    if (execution.sessionId && reason !== "missing session before work request" && reason !== "missing session after work request") {
      await this._tryAbort(client, execution.sessionId)
    }
  }

  private async _tryAbort(client: OpencodeAgentClientInterface, sessionId: string): Promise<void> {
    try { await client.abort(sessionId) } catch (error) { console.error(`Could not stop session ${sessionId}:`, error) }
  }

  private async _complete(assignment: Assignment, ticket: Ticket, execution: Execution): Promise<void> {
    const owner = await this.lock.tryAcquire()
    if (!owner) return
    let completionError: unknown
    try {
      const current = await this.database.getAssignment(assignment.id)
      if (!current) throw new Error(`Assignment ${assignment.id} no longer exists`)
      if (current.completedAt !== null) return
      await this.vikunja.moveToColumn(ticket.vikunjaTaskId, execution.status === "succeeded" ? "Done" : "Retry")
      await this.database.updateAssignmentStatus(assignment.id, execution.status)
      await this.database.completeAssignment(assignment.id, this._timestamp())
    } catch (error) {
      completionError = error
      throw error
    } finally {
      try {
        await this.lock.release(owner)
      } catch (error) {
        // Surface release failures, including both errors if completion also failed.
        // eslint-disable-next-line no-unsafe-finally, preserve-caught-error
        if (completionError !== undefined) throw new AggregateError([completionError, error], "Completion and lock release failed")
        // eslint-disable-next-line no-unsafe-finally
        throw error
      }
    }
  }

  private _timestamp(): string { return this.now().toISOString() }
}
