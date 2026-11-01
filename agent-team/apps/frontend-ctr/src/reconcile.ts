// Rebuilds the in-flight run from the ticket's comments. The controller keeps no state of its own.
import type { Comment } from "./vikunja.js"
import { failedHeader, markerHeader, parseMarker, reportHeader, wrapupHeader, type Marker } from "./prompt.js"

export interface RunState {
  marker: Marker
  markerCommentId: number
  /** Prompt id of the wrap-up message, once sent. */
  wrapupPrompt: string | null
  reported: boolean
  /** Message id after which the worker's idle state and reply count. */
  since: string
}

export interface Attempts {
  started: number
  failed: number
}

export const countAttempts = (comments: Comment[]): Attempts => ({
  started: comments.filter((c) => c.comment.startsWith(markerHeader)).length,
  failed: comments.filter((c) => c.comment.startsWith(failedHeader)).length,
})

/** The run recorded by the newest marker comment, or null when the ticket has none. */
export function reconcile(comments: Comment[]): RunState | null {
  let found: { marker: Marker; id: number } | null = null
  for (const c of comments) {
    const marker = parseMarker(c.comment)
    if (marker) found = { marker, id: c.id }
  }
  if (!found) return null

  const after = comments.filter((c) => c.id > found!.id)
  const wrapup = after.find((c) => c.comment.startsWith(wrapupHeader))
  const wrapupPrompt = wrapup ? (/^prompt: (.+)$/m.exec(wrapup.comment)?.[1]?.trim() ?? "") : null
  return {
    marker: found.marker,
    markerCommentId: found.id,
    wrapupPrompt,
    reported: after.some((c) => c.comment.startsWith(reportHeader)),
    since: wrapupPrompt || found.marker.prompt,
  }
}
