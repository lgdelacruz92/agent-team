// Creates the Express app without starting a server or dispatching work.
import express from "express"
import type { SchedulerStatus } from "./components/scheduler-status.js"

export function createApp(status: Pick<SchedulerStatus, "snapshot">) {
  const app = express()
  app.disable("x-powered-by")

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "scheduler" })
  })

  app.get("/status", (_req, res) => {
    res.json(status.snapshot())
  })

  return app
}
