// Starts the HTTP server and continuous scheduling with the configured components.
import { createApp } from "./app.js"
import { AgentManager } from "./components/agent-manager.js"
import { AssignmentMonitor } from "./components/assignment-monitor.js"
import { Scheduler } from "./components/scheduler.js"
import { SchedulerDatabase } from "./components/scheduler-database.js"
import { SchedulerStatus } from "./components/scheduler-status.js"
import { Vikunja } from "./components/vikunja.js"
import { config } from "./config.js"
import { openDatabase } from "./db/database.js"
import { AgentStore } from "./db/agent-store.js"
import { AssignmentStore } from "./db/assignment-store.js"
import { runSchedulerLoop } from "./scheduler-loop.js"

if (!config.vikunja.baseUrl) {
  throw new Error("VIKUNJA_URL is required")
}

const vikunja = new Vikunja(config.vikunja)
const database = openDatabase(config.databasePath)
const schedulerDatabase = new SchedulerDatabase(database)
const assignments = new AssignmentStore(database)
const agentManager = new AgentManager(schedulerDatabase, new AgentStore(database), assignments)
const assignmentMonitor = new AssignmentMonitor(assignments, config.assignmentWarningMs)
const scheduler = new Scheduler(vikunja, schedulerDatabase, agentManager)
const status = new SchedulerStatus(scheduler)

const schedulingController = new AbortController()
let scheduling: Promise<void> = Promise.resolve()
const server = createApp(status).listen(config.port, config.host, () => {
  console.log(`scheduler listening on http://${config.host}:${config.port}`)
  scheduling = runSchedulerLoop(status, config.pollMs, schedulingController.signal, undefined, () => assignmentMonitor.check()).catch((error) => {
    console.error("scheduler loop failed:", error)
    process.exitCode = 1
    shutdown()
  })
})

server.on("error", (error) => {
  console.error("scheduler server failed:", error)
  process.exitCode = 1
  shutdown()
})

// Stop accepting requests and finish scheduling before releasing the database.
let stopping = false

function shutdown(): void {
  if (stopping) {
    return
  }

  stopping = true
  schedulingController.abort()
  server.close(async () => {
    // Cancel the polling wait, but finish an active pass before closing SQLite.
    await scheduling
    database.close()
  })
  server.closeIdleConnections()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
