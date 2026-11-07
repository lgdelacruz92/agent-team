// Starts the app's process loop without creating a Resource Manager yet.
import { runProcessLoop } from "./process-loop.js"

const controller = new AbortController()

process.on("SIGINT", () => controller.abort())
process.on("SIGTERM", () => controller.abort())

runProcessLoop(controller.signal).catch((error: unknown) => {
  console.error("Resource Manager loop failed:", error)
  process.exitCode = 1
})
