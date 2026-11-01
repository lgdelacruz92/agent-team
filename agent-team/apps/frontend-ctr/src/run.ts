// Run lifecycle: start, watch, wrap up, abort, finish. Each tick advances the run by reading the board,
// so a restart in the middle of a run loses nothing.
import { config } from "./config.js"
import * as oc from "./opencode.js"
import * as vk from "./vikunja.js"
import { branchName, buildPrompt, buildWrapup, failedHeader, formatMarker, notReadyHeader, reportBody, reportHeader, wrapupHeader, type DoneBlocker } from "./prompt.js"
import { countAttempts, reconcile } from "./reconcile.js"
import { select, unblocked, type Skipped, type Ticket } from "./select.js"

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args)

export interface Snapshot {
  paused: boolean
  dryRun: boolean
  lastTick: string | null
  lastError: string | null
  run: null | { ticket: number; title: string; session: string; branch: string; softDeadline: string; hardDeadline: string; wrapupSent: boolean }
  queue: { id: number; title: string; status: string | null; goal: number | null }[]
  skipped: Skipped[]
}

export class Controller {
  paused = false
  private busy = false
  private snapshot: Snapshot = { paused: false, dryRun: config.dryRun, lastTick: null, lastError: null, run: null, queue: [], skipped: [] }

  status(): Snapshot {
    return { ...this.snapshot, paused: this.paused }
  }

  /** Runs one tick. A second call while one is in progress is ignored (the in-process mutex). */
  async tick(): Promise<boolean> {
    if (this.busy) return false
    this.busy = true
    try {
      this.snapshot.lastError = null
      if (this.paused) return true
      const board = await vk.loadBoard()
      const tickets = await vk.listTickets(board)
      const inProgress = tickets.filter((t) => t.status === "inProgress").sort((a, b) => a.id - b.id)
      if (inProgress.length > 1) log(`warning: ${inProgress.length} tickets in progress, watching #${inProgress[0].id}`)
      if (inProgress.length) await this.watch(board, inProgress[0])
      else await this.startNext(board, tickets)
    } catch (err) {
      this.snapshot.lastError = (err as Error).message
      log("tick failed:", (err as Error).message)
    } finally {
      this.snapshot.lastTick = new Date().toISOString()
      this.busy = false
    }
    return true
  }

  // ---- no run in flight: pick one ----

  private async startNext(board: vk.Board, tickets: Ticket[]) {
    this.snapshot.run = null
    const commentsOf = new Map<number, vk.Comment[]>()
    const candidates = unblocked(tickets)
    for (const t of candidates) {
      const comments = await vk.listComments(t.id)
      commentsOf.set(t.id, comments)
      t.failures = countAttempts(comments).failed
    }

    const { queue, skipped } = select(tickets, { maxFailures: config.maxFailures })
    this.snapshot.queue = queue.map((t) => ({ id: t.id, title: t.title, status: t.status, goal: t.goal }))
    this.snapshot.skipped = skipped

    // Tell the CTO once about each skipped ticket.
    for (const s of skipped) {
      const text = `${notReadyHeader}\nSkipped: ${s.reason}. The CTO needs to fix the ticket.`
      const comments = commentsOf.get(s.id) ?? []
      if (!comments.some((c) => c.comment === text) && !config.dryRun) await vk.addComment(s.id, text).catch((e) => log(e.message))
    }

    const next = queue[0]
    if (!next) return
    if (config.dryRun) return void log(`dry run: would start #${next.id} ${next.title}`)
    await this.startRun(board, next, tickets, commentsOf.get(next.id) ?? [])
  }

  private budgetMin(ticket: Ticket, now: Date): number {
    if (ticket.dueDate) {
      const remaining = (new Date(ticket.dueDate).getTime() - now.getTime()) / 60_000
      // A due date in the past falls back to the default budget (proposal open question 2).
      if (remaining > 0) return Math.min(remaining, config.maxRunMin)
    }
    return Math.min(config.defaultBudgetMin, config.maxRunMin)
  }

  private async startRun(board: vk.Board, ticket: Ticket, tickets: Ticket[], comments: vk.Comment[]) {
    const now = new Date()
    const budget = this.budgetMin(ticket, now)
    const softDeadline = new Date(now.getTime() + budget * 0.8 * 60_000)
    const hardDeadline = new Date(now.getTime() + (budget + config.graceMin) * 60_000)
    const branch = branchName(ticket.id, ticket.title)

    const blockers: DoneBlocker[] = []
    for (const b of ticket.blockers) {
      const known = tickets.find((t) => t.id === b.id)
      const reports = (await vk.listComments(b.id)).map((c) => reportBody(c.comment)).filter((r): r is string => !!r)
      blockers.push({ id: b.id, title: known?.title ?? `#${b.id}`, report: reports.at(-1) ?? "" })
    }
    const prompt = buildPrompt({ id: ticket.id, title: ticket.title, description: ticket.description, blockers, softDeadline, hardDeadline, branch })

    let session: string
    try {
      session = await oc.createSession(`#${ticket.id} ${ticket.title}`)
    } catch (err) {
      return void log(`opencode unreachable, will retry next tick: ${(err as Error).message}`)
    }

    try {
      await vk.setStatus(board, ticket.id, "inProgress")
      const promptId = await oc.sendPrompt(session, prompt)
      await vk.addComment(ticket.id, formatMarker({ session, prompt: promptId, branch, softDeadline, hardDeadline }))
      log(`started #${ticket.id} in session ${session}, soft ${softDeadline.toISOString()}, hard ${hardDeadline.toISOString()}`)
    } catch (err) {
      await this.fail(board, ticket, comments, `could not start the run: ${(err as Error).message}`)
    }
  }

  // ---- a run is in flight: check deadlines, harvest the report ----

  private async watch(board: vk.Board, ticket: Ticket) {
    const comments = await vk.listComments(ticket.id)
    const run = reconcile(comments)
    if (!run) {
      this.snapshot.run = null
      return this.fail(board, ticket, comments, "no run marker on an In progress ticket")
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

    let state: oc.SessionState
    try {
      state = await oc.inspect(marker.session, run.since)
    } catch (err) {
      if (err instanceof oc.OpencodeError && err.status === 404) return this.fail(board, ticket, comments, "the session is gone")
      return void log(`opencode unreachable, will check again next tick: ${(err as Error).message}`)
    }

    const now = new Date()
    const timedOut = run.wrapupPrompt !== null

    if (state.idle) {
      if (!state.report) return this.fail(board, ticket, comments, state.error ? `the worker failed: ${state.error}` : "the worker finished with an empty report")
      return this.finish(board, ticket, run.reported, state.report, timedOut)
    }

    if (now >= marker.hardDeadline) {
      await oc.abort(marker.session).catch((e) => log(`abort failed: ${e.message}`))
      const pr = await findPullRequest(marker.branch)
      if (!pr) return this.fail(board, ticket, comments, "hard deadline reached with no pull request on the branch")
      const body = `${pr ? `Pull request on the branch: ${pr}` : "No pull request found on the branch."}${state.report ? `\n\nLast message from the worker:\n${state.report}` : ""}`
      return this.finish(board, ticket, run.reported, body, true, "hard deadline, session aborted")
    }

    if (now >= marker.softDeadline && !timedOut) {
      // A new message after an abort, not a queued one: a queued message would wait for the current turn.
      await oc.abort(marker.session)
      const promptId = await oc.sendPrompt(marker.session, buildWrapup({ branch: marker.branch, hardDeadline: marker.hardDeadline }))
      await vk.addComment(ticket.id, `${wrapupHeader}\nprompt: ${promptId}`)
      log(`soft deadline for #${ticket.id}: wrap-up sent`)
    }
  }

  private async finish(board: vk.Board, ticket: Ticket, alreadyReported: boolean, report: string, timedOut: boolean, note = "run timed out") {
    // The report comment goes first so nothing is lost if the status move fails and is retried next tick.
    if (!alreadyReported) await vk.addComment(ticket.id, `${reportHeader}${timedOut ? ` (${note})` : ""}\n\n${report}`)
    await vk.setStatus(board, ticket.id, "review")
    log(`#${ticket.id} moved to Review${timedOut ? " (timed out)" : ""}`)
  }

  /** Comment with the reason; back to Ready on the first attempt, Retry after that. */
  private async fail(board: vk.Board, ticket: Ticket, comments: vk.Comment[], reason: string) {
    const { started } = countAttempts(comments)
    await vk.addComment(ticket.id, `${failedHeader}\n${reason}`)
    await vk.setStatus(board, ticket.id, started <= 1 ? "ready" : "retry")
    log(`#${ticket.id} run failed: ${reason}`)
  }
}

/** Looks for an open pull request on the branch. Returns null when none is found or GitHub is not configured. */
async function findPullRequest(branch: string): Promise<string | null> {
  if (!config.githubRepo || !config.githubToken) return null
  try {
    const owner = config.githubRepo.split("/")[0]
    const res = await fetch(`https://api.github.com/repos/${config.githubRepo}/pulls?state=all&head=${owner}:${encodeURIComponent(branch)}`, {
      headers: { Authorization: `Bearer ${config.githubToken}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const pulls: any[] = await res.json()
    return pulls[0]?.html_url ?? null
  } catch {
    return null
  }
}

