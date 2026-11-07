// Defines the Resource Manager's entry point for one reconciliation pass.

export interface ResourceManagerInterface {
  // Check agents and reconcile assignments once; the runner decides when to repeat.
  runOnce(): Promise<void>
}
