// Types for the Vikunja REST client.

// A label attached to a Vikunja task.
export interface VikunjaLabelInterface {
  id: number
  title: string
}

// A Vikunja task, limited to the fields the controller reads.
export interface VikunjaTaskInterface {
  id: number
  title: string
  description: string
  done: boolean
  due_date: string
  labels: VikunjaLabelInterface[] | null
  related_tasks?: Record<string, VikunjaTaskInterface[]>
}

// A Kanban column and the tasks inside it.
export interface VikunjaBucketInterface {
  id: number
  title: string
  tasks: VikunjaTaskInterface[] | null
}

// A project view (list, kanban, ...).
export interface VikunjaViewInterface {
  id: number
  view_kind: string
}

// A comment on a task.
export interface VikunjaCommentInterface {
  id: number
  created: string
  comment: string
}
