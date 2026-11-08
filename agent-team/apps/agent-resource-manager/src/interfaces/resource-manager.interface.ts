// Defines the Resource Manager's entry point for one reconciliation pass.

export interface ResourceManagerInterface {
  // Run one pass; agent checks are implemented and assignment reconciliation is not yet.
  runOnce(): Promise<void>
}
