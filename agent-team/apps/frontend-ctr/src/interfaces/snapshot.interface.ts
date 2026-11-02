// Shape of the controller state returned by GET /status.

// A point-in-time view of the controller: what it is doing and what it is holding back.
export interface SnapshotInterface {
  // True while the controller is not starting new runs.
  paused: boolean

  // When the last tick ran, and what went wrong in it, if anything.
  lastTick: null
  lastError: null

  // The run in flight, the ordered queue, and the tickets skipped.
  run: null
  queue: []
  skipped: []
}
