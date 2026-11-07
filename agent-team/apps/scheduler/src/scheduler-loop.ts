// Repeats scheduling passes without overlapping them.
import { setTimeout } from "node:timers/promises"
import type { SchedulerInterface } from "./interfaces/scheduler.interface.js"

export async function runSchedulerLoop(
  scheduler: SchedulerInterface,
  pollMs: number,
  signal: AbortSignal,
  onError: (error: unknown) => void = (error) => console.error("scheduler pass failed:", error),
): Promise<void> {
  while (!signal.aborted) {
    try {
      await scheduler.runOnce()
    } catch (error) {
      onError(error)
    }

    if (signal.aborted) {
      return
    }

    try {
      // Wait after each pass, whether it succeeded, failed, or found no work.
      await setTimeout(pollMs, undefined, { signal })
    } catch (error) {
      if (!signal.aborted) {
        throw error
      }
    }
  }
}
