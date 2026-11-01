// Types for the run lifecycle.
import type { Marker } from "./prompt.js"
import type { Skipped } from "./ticket.js"

// The in-flight run, rebuilt from the ticket's comments.
export interface RunState {
  marker: Marker
  markerCommentId: number

  // Prompt id of the wrap-up message, once sent.
  wrapupPrompt: string | null
  reported: boolean

  // Message id after which the worker's idle state and reply count.
  since: string
}

// How many runs started and failed on one ticket.
export interface Attempts {
  started: number
  failed: number
}

// What GET /status returns.
export interface Snapshot {
  paused: boolean
  dryRun: boolean
  lastTick: string | null
  lastError: string | null
  run: null | {
    ticket: number
    title: string
    session: string
    branch: string
    softDeadline: string
    hardDeadline: string
    wrapupSent: boolean
  }
  queue: { id: number; title: string; status: string | null; goal: number | null }[]
  skipped: Skipped[]
}
