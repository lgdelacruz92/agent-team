// Runs non-overlapping Resource Manager passes until shutdown is requested.
import { setTimeout } from "node:timers/promises"
import type { ResourceManagerInterface } from "./interfaces/resource-manager.interface.js"

// A failed pass is logged and retried on the next tick.
export async function runProcessLoop(manager: ResourceManagerInterface, pollMs: number, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      await manager.runOnce()
    } catch (error) {
      console.error("Resource Manager pass failed:", error)
    }

    if (signal.aborted) {
      return
    }

    try {
      await setTimeout(pollMs, undefined, { signal })
    } catch (error) {
      if (!signal.aborted) {
        throw error
      }
    }
  }
}
