// Defines the scheduler's entry point for one pass through the workflow.

export interface SchedulerInterface {
  // Sync tickets, select work, and attempt an assignment once. No agent available means retry on a later pass.
  runOnce(): Promise<void>
}
