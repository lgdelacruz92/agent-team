// Types for building prompts and the marker comment.

// A finished blocker whose report goes into the next ticket's prompt.
export interface DoneBlocker {
  id: number
  title: string
  report: string
}

// Everything the worker prompt is built from.
export interface PromptInput {
  id: number
  title: string
  description: string
  blockers: DoneBlocker[]
  softDeadline: Date
  hardDeadline: Date
  branch: string
}

// The data written in the "run started" comment and read back after a restart.
export interface Marker {
  session: string
  prompt: string
  branch: string
  softDeadline: Date
  hardDeadline: Date
}
