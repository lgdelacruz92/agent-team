// Pure: build the worker and wrap-up prompts and the marker comments. No I/O.
import { config } from "../config.js"
import type { Marker, PromptInput } from "../interfaces/prompt.js"

// Headers that identify the controller's own comments on a ticket.
export const markerHeader = `${config.marker} run started`
export const failedHeader = `${config.marker} run failed`
export const wrapupHeader = `${config.marker} wrap-up sent`
export const reportHeader = `${config.marker} report`
export const notReadyHeader = `${config.marker} not ready`

// The report the worker must finish with, including the honesty reminder.
export const REPORT_FORMAT = [
  "Finish with a report that lists:",
  "- files modified",
  "- tests executed",
  "- results",
  "- skipped tests",
  "- blockers",
  "- anything left undone",
  "Do not claim a test passed unless you ran it.",
].join("\n")

// Turns a title into a short lowercase string safe for a branch name.
export const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "")

// The branch the worker uses: ticket-<id>-<slug>.
export function branchName(id: number, title: string): string {
  const titleSlug = slug(title)

  if (titleSlug) {
    return `ticket-${id}-${titleSlug}`
  }

  return `ticket-${id}`
}

// A clock time such as "10:24 UTC".
const clock = (date: Date): string => `${date.toISOString().slice(11, 16)} UTC`

// The prompt for a new run, assembled only from board data because the worker works only from the prompt.
export function buildPrompt(input: PromptInput): string {
  const parts = [`Ticket #${input.id}: ${input.title}`, "", input.description.trim()]

  // Finished blockers: the worker needs their file paths, routes, ports and env var names.
  if (input.blockers.length > 0) {
    parts.push("", "## Finished work you build on")

    for (const blocker of input.blockers) {
      const report = blocker.report.trim() || "(no report was recorded)"
      parts.push("", `### #${blocker.id} ${blocker.title}`, report)
    }
  }

  parts.push(
    "",
    "## Time",
    `Aim to be finished by ${clock(input.softDeadline)}. The session is cut off at ${clock(input.hardDeadline)}.`,
    "",
    "## Branch",
    `Work on the branch \`${input.branch}\`.`,
    "",
    "## Report",
    REPORT_FORMAT,
  )

  return parts.join("\n")
}

// The message sent after the soft deadline: commit, open a WIP pull request, report.
export function buildWrapup(input: { branch: string; hardDeadline: Date }): string {
  return [
    "Time is nearly up. Stop new work now.",
    "",
    `1. Commit what you have on the branch \`${input.branch}\` and push it.`,
    "2. Open a pull request with the title prefixed `WIP:`.",
    `3. Report before ${clock(input.hardDeadline)}.`,
    "",
    REPORT_FORMAT,
    "Include the pull request link, what is done and what is left.",
  ].join("\n")
}

// Writes the "run started" comment. It must stay parseable by parseMarker.
export function formatMarker(marker: Marker): string {
  return [
    markerHeader,
    `session: ${marker.session}`,
    `prompt: ${marker.prompt}`,
    `branch: ${marker.branch}`,
    `soft_deadline: ${marker.softDeadline.toISOString()}`,
    `hard_deadline: ${marker.hardDeadline.toISOString()}`,
  ].join("\n")
}

// Reads one "key: value" line from a comment, or undefined when it is missing.
function readField(comment: string, name: string): string | undefined {
  return comment.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1]?.trim()
}

// Reads a "run started" comment back into a Marker; null when the comment is not one or is incomplete.
export function parseMarker(comment: string): Marker | null {
  if (!comment.startsWith(markerHeader)) {
    return null
  }

  const session = readField(comment, "session")
  const branch = readField(comment, "branch")
  const soft = readField(comment, "soft_deadline")
  const hard = readField(comment, "hard_deadline")
  if (!session || !branch || !soft || !hard) {
    return null
  }

  const softDeadline = new Date(soft)
  const hardDeadline = new Date(hard)
  if (isNaN(softDeadline.getTime()) || isNaN(hardDeadline.getTime())) {
    return null
  }

  return { session, prompt: readField(comment, "prompt") ?? "", branch, softDeadline, hardDeadline }
}

// Strips the controller's report header so the text can go into another ticket's prompt.
// Returns null when the comment is not a report.
export const reportBody = (comment: string) => {
  if (comment.startsWith(reportHeader)) {
    return comment.slice(reportHeader.length).replace(/^[^\n]*\n/, "").trim()
  }

  return null
}
