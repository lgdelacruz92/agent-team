// Starts the standalone Express server and closes SQLite on shutdown.
import { createApp } from "./app.js"
import { config } from "./config.js"
import { StateStore } from "./state-store.js"

const store = new StateStore(config.databasePath)
const server = createApp(store).listen(config.port, config.host, () => {
  console.log(`scheduler listening on http://${config.host}:${config.port}`)
})

server.on("error", (error) => {
  console.error("scheduler server failed:", error)
  store.close()
  process.exitCode = 1
})

// Stop accepting requests before releasing the database used by route handlers.
let stopping = false

function shutdown(): void {
  if (stopping) {
    return
  }

  stopping = true
  server.close(() => {
    store.close()
  })
  server.closeIdleConnections()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
