// Types for the opencode client.

// One message in a session.
export interface Message {
  id: string
  type: string
  content?: { type: string; text?: string }[]
  error?: { message?: string }
}

// What the controller learns by looking at a session without blocking.
export interface SessionState {
  // The run started by the prompt has ended.
  idle: boolean

  // Text of the worker's last reply, if any.
  report: string
  error: string | null
}
