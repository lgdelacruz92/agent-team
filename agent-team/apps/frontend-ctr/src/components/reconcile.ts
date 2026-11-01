// Rebuilds the in-flight run from the ticket's comments. The controller keeps no state of its own.
import type { Marker } from "../interfaces/prompt.js"
import type { Attempts, RunState } from "../interfaces/run.js"
import type { Comment } from "../interfaces/vikunja.js"
import { failedHeader, markerHeader, parseMarker, reportHeader, wrapupHeader } from "./prompt.js"

// Counts how many runs started and failed, from the controller's own comments.
export function countAttempts(comments: Comment[]): Attempts {
  return {
    started: comments.filter((c) => c.comment.startsWith(markerHeader)).length,
    failed: comments.filter((c) => c.comment.startsWith(failedHeader)).length,
  }
}

// The run recorded by the newest marker comment, or null when the ticket has none.
export function reconcile(comments: Comment[]): RunState | null {
  let found: { marker: Marker; id: number } | null = null

  // Comments are in id order, so the last marker wins.
  for (const comment of comments) {
    const marker = parseMarker(comment.comment)

    if (marker) {
      found = { marker, id: comment.id }
    }
  }

  if (!found) {
    return null
  }

  // Only comments written after the newest marker belong to this run.
  const foundId = found.id
  const after = comments.filter((c) => c.id > foundId)
  const wrapup = after.find((c) => c.comment.startsWith(wrapupHeader))

  let wrapupPrompt: string | null = null
  if (wrapup) {
    wrapupPrompt = /^prompt: (.+)$/m.exec(wrapup.comment)?.[1]?.trim() ?? ""
  }

  return {
    marker: found.marker,
    markerCommentId: found.id,
    wrapupPrompt,
    reported: after.some((c) => c.comment.startsWith(reportHeader)),

    // Messages before the wrap-up prompt (or the first prompt) belong to an earlier turn.
    since: wrapupPrompt || found.marker.prompt,
  }
}
