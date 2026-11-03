// Contract for a unit of work the scheduler hands to a worker. The scheduler and the workers only know this
// shape, so a task can come from any source (Vikunja, a file, a test) as long as it fits.

// A task that is ready to be worked on.
export interface TaskInterface {
  // Unique within its source. Used to name the session and the branch.
  readonly id: string | number

  // Short name of the task.
  readonly title: string

  // What the worker is asked to do.
  readonly description: string
}
