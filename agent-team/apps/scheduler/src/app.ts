// Creates the dummy Express app without starting a server or dispatching work.
import express from "express"
import type { ErrorRequestHandler } from "express"
import type { StateStore } from "./db/state-store.js"

// The database is injected so tests can use a temporary or in-memory store.
export function createApp(store: StateStore) {
  const app = express()
  app.disable("x-powered-by")
  app.use(express.json({ limit: "100kb" }))

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "scheduler" })
  })

  app.get("/state/:key", (req, res) => {
    const value = store.get(req.params.key)

    if (value === undefined) {
      res.status(404).json({ error: "State key not found" })
      return
    }

    res.json({ key: req.params.key, value })
  })

  app.put("/state/:key", (req, res) => {
    if (!req.body || !Object.hasOwn(req.body, "value")) {
      res.status(400).json({ error: "Request body must contain value" })
      return
    }

    store.set(req.params.key, req.body.value)
    res.json({ key: req.params.key, value: req.body.value })
  })

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON" })
      return
    }

    if (error.type === "entity.too.large") {
      res.status(413).json({ error: "Request body too large" })
      return
    }

    console.error("scheduler request failed:", error)
    res.status(500).json({ error: "Internal server error" })
  }

  app.use(handleError)

  return app
}
