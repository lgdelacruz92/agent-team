// Types for the Vikunja REST client.

// A label attached to a Vikunja task.
export interface VikunjaLabel {
  id: number
  title: string
}

// A Vikunja task, limited to the fields the controller reads.
export interface VikunjaTask {
  id: number
  title: string
  description: string
  done: boolean
  due_date: string
  labels: VikunjaLabel[] | null
  related_tasks?: Record<string, VikunjaTask[]>
}

// A Kanban column and the tasks inside it.
export interface VikunjaBucket {
  id: number
  title: string
  tasks: VikunjaTask[] | null
}

// A project view (list, kanban, ...).
export interface VikunjaView {
  id: number
  view_kind: string
}

// A comment on a task.
export interface VikunjaComment {
  id: number
  created: string
  comment: string
}
