// Runs the app's idle process loop until shutdown is requested.
import { setTimeout } from "node:timers/promises"

// Keep the process alive without starting any Resource Manager work yet.
export async function runProcessLoop(signal: AbortSignal): Promise<void> {
  const pollMs = 30_000

  while (!signal.aborted) {
    console.log("Resource Manager loop: idle")

    try {
      await setTimeout(pollMs, undefined, { signal })
    } catch (error) {
      if (!signal.aborted) {
        throw error
      }
    }
  }
}
