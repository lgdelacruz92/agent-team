// Creates the Express app without starting a server or dispatching work.
import express from "express"

export function createApp() {
  const app = express()
  app.disable("x-powered-by")

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "scheduler" })
  })

  return app
}
