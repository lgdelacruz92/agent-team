import express from "express"
import { config } from "./config.js"
import { Controller } from "./run.js"

const controller = new Controller()
const app = express()

app.get("/health", (_req, res) => void res.json({ ok: true }))
app.get("/status", (_req, res) => void res.json(controller.status()))
app.post("/pause", (_req, res) => {
  controller.paused = true
  res.json({ paused: true })
})
app.post("/resume", (_req, res) => {
  controller.paused = false
  res.json({ paused: false })
})
app.post("/tick", async (_req, res) => {
  const ran = await controller.tick()
  res.json({ ran, ...controller.status() })
})

if (!config.vikunjaToken) console.error("VIKUNJA_API_TOKEN is not set")
if (!config.projectId) console.error("CTR_PROJECT_ID is not set")

app.listen(config.port, config.host, () => {
  console.log(`frontend-ctr listening on ${config.host}:${config.port}${config.dryRun ? " (dry run)" : ""}`)
})

const loop = async () => {
  if (config.projectId && config.vikunjaToken) await controller.tick()
  setTimeout(loop, config.pollMs)
}
void loop()
