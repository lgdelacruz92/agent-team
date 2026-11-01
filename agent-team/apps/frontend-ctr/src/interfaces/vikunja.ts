// Types for the Vikunja client.
import type { Status } from "./ticket.js"

// A comment on a ticket, in plain text.
export interface Comment {
  id: number
  created: string
  comment: string
}

// The Kanban view of the project: every task plus the bucket (status) each one sits in.
export interface Board {
  projectId: number
  viewId: number

  // Bucket id by status.
  buckets: Map<Status, number>
  tasks: any[]
  statusOf: Map<number, Status>
}
