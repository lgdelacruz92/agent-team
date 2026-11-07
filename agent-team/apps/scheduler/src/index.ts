// Starts the HTTP server and runs one scheduling pass with the configured components.
import { createApp } from "./app.js"
import { AgentManager } from "./components/agent-manager.js"
import { Scheduler } from "./components/scheduler.js"
import { SchedulerDatabase } from "./components/scheduler-database.js"
import { Vikunja } from "./components/vikunja.js"
import { config } from "./config.js"
import { openDatabase } from "./db/database.js"
import { StateStore } from "./db/state-store.js"
import { TicketStore } from "./db/ticket-store.js"

if (!config.vikunja.baseUrl) {
  throw new Error("VIKUNJA_URL is required")
}

const vikunja = new Vikunja(config.vikunja)
const database = openDatabase(config.databasePath)
const schedulerDatabase = new SchedulerDatabase(new TicketStore(database))
const agentManager = new AgentManager(schedulerDatabase)
const scheduler = new Scheduler(vikunja, schedulerDatabase, agentManager)
const store = new StateStore(config.databasePath)

// A failed pass is logged; the HTTP scaffold stays available. No polling loop yet.
let scheduling: Promise<void> = Promise.resolve()
const server = createApp(store).listen(config.port, config.host, () => {
  console.log(`scheduler listening on http://${config.host}:${config.port}`)
  scheduling = scheduler.runOnce().catch((error) => {
    console.error("scheduler pass failed:", error)
  })
})

server.on("error", async (error) => {
  console.error("scheduler server failed:", error)
  await scheduling
  store.close()
  database.close()
  process.exitCode = 1
})

// Stop accepting requests before releasing the database used by route handlers.
let stopping = false

function shutdown(): void {
  if (stopping) {
    return
  }

  stopping = true
  server.close(async () => {
    // Let the in-flight pass finish before releasing either SQLite connection.
    await scheduling
    store.close()
    database.close()
  })
  server.closeIdleConnections()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
