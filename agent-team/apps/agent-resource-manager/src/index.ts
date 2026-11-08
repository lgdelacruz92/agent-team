// Starts agent checks against the prepared shared database.
import { AgentDatabase } from "./components/agent-database.js"
import { OpencodeAgentClient } from "./components/opencode-agent-client.js"
import { ResourceManager } from "./components/resource-manager.js"
import { config } from "./config.js"
import { openDatabase } from "./db/database.js"
import { runProcessLoop } from "./process-loop.js"

const database = openDatabase(config.databasePath)
const manager = new ResourceManager(new AgentDatabase(database), (url) => new OpencodeAgentClient(url, config.opencodeHeaders))
const controller = new AbortController()

process.on("SIGINT", () => controller.abort())
process.on("SIGTERM", () => controller.abort())

runProcessLoop(manager, config.pollMs, controller.signal)
  .catch((error: unknown) => {
    console.error("Resource Manager loop failed:", error)
    process.exitCode = 1
  })
  .finally(() => database.close())
