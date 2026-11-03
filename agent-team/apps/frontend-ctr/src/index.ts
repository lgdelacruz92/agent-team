// Entry point: the HTTP surface for operating the controller, and the polling loop.
import express from "express"
import { config } from "./config.js"
import { TaskScheduler } from "./services/task-scheduler.js"
import { OpencodeAgent } from "./services/opencode-agent.js"
import type { TaskInterface } from "./interfaces/task.interface.js"
import type { WorkerInterface } from "./interfaces/worker.interface.js"
import { OpencodeWorker } from "./components/opencode-worker.js"

// The workers and the ready queue are built here and handed to the scheduler.
// One worker for now: the frontend worker, at the configured opencode URL.
// Whatever fetches tasks (Vikunja or anything else) pushes them into `ready`; the scheduler does not care who.
const ready: TaskInterface[] = []

const agent = new OpencodeAgent(config.opencodeUser, [], config.opencodeUrl);
const workers: WorkerInterface[] = []
workers.push(new OpencodeWorker(config.opencodeUser, ['react'], agent));
const controller = new TaskScheduler(workers, [])
const app = express()

// Liveness, for the compose healthcheck.
app.get("/health", (_req, res) => void res.json({ ok: true }))

// Current run and deadlines, ordered queue, tickets skipped and why.
app.get("/status", (_req, res) => void res.json(controller.status()))

// Stop starting new runs without touching the one in flight. In memory only, so a restart resumes.
app.post("/pause", (_req, res) => {
  controller.paused = true
  res.json({ paused: true })
})

app.post("/resume", (_req, res) => {
  controller.paused = false
  res.json({ paused: false })
})

// Run one tick now, for debugging.
app.post("/tick", async (_req, res) => {
  const ran = await controller.tick()
  res.json({ ran, ...controller.status() })
})

if (!config.vikunjaToken) {
  console.error("VIKUNJA_API_TOKEN is not set")
}

if (!config.projectId) {
  console.error("CTR_PROJECT_ID is not set")
}

app.listen(config.port, config.host, () => {
  let mode = ""
  if (config.dryRun) {
    mode = " (dry run)"
  }

  console.log(`frontend-ctr listening on ${config.host}:${config.port}${mode}`)
})

// Ticks run back to back with a pause between them, so two ticks never overlap.
async function loop() {
  if (config.projectId && config.vikunjaToken) {
    await controller.tick()
  }

  setTimeout(loop, config.pollMs)
}

void loop()
