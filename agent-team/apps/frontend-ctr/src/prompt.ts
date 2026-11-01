// Pure: build the worker and wrap-up prompts. No I/O.
import { config } from "./config.js"

export interface DoneBlocker {
  id: number
  title: string
  report: string
}

export interface PromptInput {
  id: number
  title: string
  description: string
  blockers: DoneBlocker[]
  softDeadline: Date
  hardDeadline: Date
  branch: string
}

export const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "")

export const branchName = (id: number, title: string) => {
  const s = slug(title)
  return s ? `ticket-${id}-${s}` : `ticket-${id}`
}

const clock = (d: Date) => d.toISOString().slice(11, 16) + " UTC"

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

export function buildPrompt(input: PromptInput): string {
  const parts = [`Ticket #${input.id}: ${input.title}`, "", input.description.trim()]

  if (input.blockers.length) {
    parts.push("", "## Finished work you build on")
    for (const b of input.blockers) {
      parts.push("", `### #${b.id} ${b.title}`, b.report.trim() || "(no report was recorded)")
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

export interface Marker {
  session: string
  prompt: string
  branch: string
  softDeadline: Date
  hardDeadline: Date
}

export const markerHeader = `${config.marker} run started`
export const failedHeader = `${config.marker} run failed`
export const wrapupHeader = `${config.marker} wrap-up sent`
export const reportHeader = `${config.marker} report`
export const notReadyHeader = `${config.marker} not ready`

export function formatMarker(m: Marker): string {
  return [
    markerHeader,
    `session: ${m.session}`,
    `prompt: ${m.prompt}`,
    `branch: ${m.branch}`,
    `soft_deadline: ${m.softDeadline.toISOString()}`,
    `hard_deadline: ${m.hardDeadline.toISOString()}`,
  ].join("\n")
}

export function parseMarker(comment: string): Marker | null {
  if (!comment.startsWith(markerHeader)) return null
  const field = (name: string) => comment.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1]?.trim()
  const session = field("session")
  const branch = field("branch")
  const soft = field("soft_deadline")
  const hard = field("hard_deadline")
  if (!session || !branch || !soft || !hard) return null
  const softDeadline = new Date(soft)
  const hardDeadline = new Date(hard)
  if (isNaN(softDeadline.getTime()) || isNaN(hardDeadline.getTime())) return null
  return { session, prompt: field("prompt") ?? "", branch, softDeadline, hardDeadline }
}

/** Strips the controller's report header so the text can go into another ticket's prompt. */
export const reportBody = (comment: string) =>
  comment.startsWith(reportHeader) ? comment.slice(reportHeader.length).replace(/^[^\n]*\n/, "").trim() : null
