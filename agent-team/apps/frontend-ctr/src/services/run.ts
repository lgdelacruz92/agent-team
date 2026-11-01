// Run lifecycle: start, watch, wrap up, abort, finish.
// Each tick advances the run by reading the board, so a restart in the middle of a run loses nothing.
import { config } from "../config.js"
import { buildPrompt, buildWrapup, branchName, failedHeader, formatMarker, notReadyHeader, reportBody, reportHeader, wrapupHeader } from "../components/prompt.js"
import { countAttempts, reconcile } from "../components/reconcile.js"
import { select, unblocked } from "../components/select.js"
import type { SessionState } from "../interfaces/opencode.js"
import type { DoneBlocker } from "../interfaces/prompt.js"
import type { Snapshot } from "../interfaces/run.js"
import type { Ticket } from "../interfaces/ticket.js"
import type { Board, Comment } from "../interfaces/vikunja.js"
import { findPullRequest } from "./github.js"
import * as opencode from "./opencode.js"
import * as vikunja from "./vikunja.js"

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

  private snapshot: Snapshot = {
    paused: false,
    dryRun: config.dryRun,
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

      const board = await vikunja.loadBoard()
      const tickets = await vikunja.listTickets(board)
      const inProgress = tickets.filter((t) => t.status === "inProgress").sort((a, b) => a.id - b.id)

      if (inProgress.length > 1) {
        log(`warning: ${inProgress.length} tickets in progress, watching #${inProgress[0].id}`)
      }

      if (inProgress.length > 0) {
        // The worker is busy: only watch the deadline.
        await this.watch(board, inProgress[0])
      } else {
        await this.startNext(board, tickets)
      }
    } catch (err) {
      this.snapshot.lastError = messageOf(err)
      log("tick failed:", messageOf(err))
    } finally {
      this.snapshot.lastTick = new Date().toISOString()
      this.busy = false
    }

    return true
  }

  // ---- No run in flight: pick one ----

  private async startNext(board: Board, tickets: Ticket[]) {
    this.snapshot.run = null

    // Load comments only for tickets that could start, to count their failed attempts.
    const commentsOf = new Map<number, Comment[]>()
    for (const ticket of unblocked(tickets)) {
      const comments = await vikunja.listComments(ticket.id)
      commentsOf.set(ticket.id, comments)
      ticket.failures = countAttempts(comments).failed
    }

    const { queue, skipped } = select(tickets, { maxFailures: config.maxFailures })
    this.snapshot.queue = queue.map((t) => ({ id: t.id, title: t.title, status: t.status, goal: t.goal }))
    this.snapshot.skipped = skipped

    // Tell the CTO once about each skipped ticket.
    for (const skip of skipped) {
      const text = `${notReadyHeader}\nSkipped: ${skip.reason}. The CTO needs to fix the ticket.`
      const comments = commentsOf.get(skip.id) ?? []
      const alreadyTold = comments.some((c) => c.comment === text)

      if (!alreadyTold && !config.dryRun) {
        await vikunja.addComment(skip.id, text).catch((err) => log(messageOf(err)))
      }
    }

    const next = queue[0]
    if (!next) {
      return
    }

    if (config.dryRun) {
      log(`dry run: would start #${next.id} ${next.title}`)
      return
    }

    await this.startRun(board, next, tickets, commentsOf.get(next.id) ?? [])
  }

  // Minutes the run may last: the time to the due date, capped by the maximum run length.
  private budgetMin(ticket: Ticket, now: Date): number {
    if (ticket.dueDate) {
      const remaining = (new Date(ticket.dueDate).getTime() - now.getTime()) / 60_000

      // A due date in the past falls back to the default budget (proposal open question 2).
      if (remaining > 0) {
        return Math.min(remaining, config.maxRunMin)
      }
    }

    return Math.min(config.defaultBudgetMin, config.maxRunMin)
  }

  // Collects the title and report of every finished blocker, for the worker prompt.
  private async doneBlockers(ticket: Ticket, tickets: Ticket[]): Promise<DoneBlocker[]> {
    const blockers: DoneBlocker[] = []

    for (const blocker of ticket.blockers) {
      const known = tickets.find((t) => t.id === blocker.id)
      const comments = await vikunja.listComments(blocker.id)
      const reports = comments.map((c) => reportBody(c.comment)).filter((r): r is string => !!r)

      blockers.push({ id: blocker.id, title: known?.title ?? `#${blocker.id}`, report: reports.at(-1) ?? "" })
    }

    return blockers
  }

  private async startRun(board: Board, ticket: Ticket, tickets: Ticket[], comments: Comment[]) {
    const now = new Date()
    const budget = this.budgetMin(ticket, now)
    const softDeadline = new Date(now.getTime() + budget * 0.8 * 60_000)
    const hardDeadline = new Date(now.getTime() + (budget + config.graceMin) * 60_000)
    const branch = branchName(ticket.id, ticket.title)

    const blockers = await this.doneBlockers(ticket, tickets)
    const prompt = buildPrompt({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      blockers,
      softDeadline,
      hardDeadline,
      branch,
    })

    // Create the session before touching the board, so an unreachable server leaves the status unchanged.
    let session: string
    try {
      session = await opencode.createSession(`#${ticket.id} ${ticket.title}`)
    } catch (err) {
      log(`opencode unreachable, will retry next tick: ${messageOf(err)}`)
      return
    }

    try {
      await vikunja.setStatus(board, ticket.id, "inProgress")
      const promptId = await opencode.sendPrompt(session, prompt)
      await vikunja.addComment(ticket.id, formatMarker({ session, prompt: promptId, branch, softDeadline, hardDeadline }))

      log(`started #${ticket.id} in session ${session}, soft ${softDeadline.toISOString()}, hard ${hardDeadline.toISOString()}`)
    } catch (err) {
      await this.fail(board, ticket, comments, `could not start the run: ${messageOf(err)}`)
    }
  }

  // ---- A run is in flight: check deadlines, harvest the report ----

  private async watch(board: Board, ticket: Ticket) {
    const comments = await vikunja.listComments(ticket.id)
    const run = reconcile(comments)

    if (!run) {
      this.snapshot.run = null
      await this.fail(board, ticket, comments, "no run marker on an In progress ticket")
      return
    }

    const { marker } = run
    this.snapshot.run = {
      ticket: ticket.id,
      title: ticket.title,
      session: marker.session,
      branch: marker.branch,
      softDeadline: marker.softDeadline.toISOString(),
      hardDeadline: marker.hardDeadline.toISOString(),
      wrapupSent: run.wrapupPrompt !== null,
    }

    let state: SessionState
    try {
      state = await opencode.inspect(marker.session, run.since)
    } catch (err) {
      if (err instanceof opencode.OpencodeError && err.status === 404) {
        await this.fail(board, ticket, comments, "the session is gone")
        return
      }

      log(`opencode unreachable, will check again next tick: ${messageOf(err)}`)
      return
    }

    const now = new Date()
    const wrapupSent = run.wrapupPrompt !== null

    // The worker is done: harvest the report, or fail the run when there is none.
    if (state.idle) {
      if (state.report) {
        await this.finish(board, ticket, run.reported, state.report, wrapupSent, "run timed out")
        return
      }

      if (state.error) {
        await this.fail(board, ticket, comments, `the worker failed: ${state.error}`)
        return
      }

      await this.fail(board, ticket, comments, "the worker finished with an empty report")
      return
    }

    // Hard deadline: abort the session and look for a pull request on the branch.
    if (now >= marker.hardDeadline) {
      await opencode.abort(marker.session).catch((err) => log(`abort failed: ${messageOf(err)}`))
      const pr = await findPullRequest(marker.branch)

      if (!pr) {
        await this.fail(board, ticket, comments, "hard deadline reached with no pull request on the branch")
        return
      }

      let body = `Pull request on the branch: ${pr}`
      if (state.report) {
        body += `\n\nLast message from the worker:\n${state.report}`
      }

      await this.finish(board, ticket, run.reported, body, true, "hard deadline, session aborted")
      return
    }

    // Soft deadline: abort the turn and send the wrap-up as a new message. A queued message
    // would wait for the current turn, which may end after the deadline.
    if (now >= marker.softDeadline && !wrapupSent) {
      await opencode.abort(marker.session)
      const promptId = await opencode.sendPrompt(marker.session, buildWrapup({ branch: marker.branch, hardDeadline: marker.hardDeadline }))
      await vikunja.addComment(ticket.id, `${wrapupHeader}\nprompt: ${promptId}`)

      log(`soft deadline for #${ticket.id}: wrap-up sent`)
    }
  }

  // Writes the report comment, then moves the ticket to Review.
  private async finish(board: Board, ticket: Ticket, alreadyReported: boolean, report: string, timedOut: boolean, note: string) {
    // The report comment goes first so nothing is lost if the status move fails and is retried next tick.
    if (!alreadyReported) {
      let header = reportHeader
      if (timedOut) {
        header = `${reportHeader} (${note})`
      }

      await vikunja.addComment(ticket.id, `${header}\n\n${report}`)
    }

    await vikunja.setStatus(board, ticket.id, "review")

    if (timedOut) {
      log(`#${ticket.id} moved to Review (timed out)`)
    } else {
      log(`#${ticket.id} moved to Review`)
    }
  }

  // Comments the reason, then moves the ticket back: Ready on the first attempt, Retry after that.
  private async fail(board: Board, ticket: Ticket, comments: Comment[], reason: string) {
    const { started } = countAttempts(comments)

    await vikunja.addComment(ticket.id, `${failedHeader}\n${reason}`)

    if (started <= 1) {
      await vikunja.setStatus(board, ticket.id, "ready")
    } else {
      await vikunja.setStatus(board, ticket.id, "retry")
    }

    log(`#${ticket.id} run failed: ${reason}`)
  }
}
