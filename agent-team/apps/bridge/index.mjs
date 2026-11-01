// Mattermost <-> CTO bridge.
//
// Logs in as a Mattermost bot, listens for direct messages and @mentions, forwards each one to
// the CTO's OpenCode server, and posts the CTO's reply back. Each Mattermost conversation (a DM,
// or a thread in a channel) is one OpenCode session, so the CTO keeps context between messages.
//
// It is an Express app. Chat comes in over the Mattermost websocket (an outbound connection, so it
// works from behind the SSM port forward). Express serves:
//   GET  /health              200 when the websocket is connected, 503 otherwise
//   POST /mattermost/webhook  optional receiver for a Mattermost slash command or outgoing webhook,
//                             enabled when MATTERMOST_WEBHOOK_TOKEN is set. Mattermost must be able
//                             to reach this URL, which it cannot from EC2 to a laptop without a tunnel.
//
// Setup:
//   1. Mattermost: System Console > Integrations > Bot Accounts > enable, then
//      Integrations > Bot Accounts > Add Bot Account (username "cto"). Copy the access token.
//   2. Put MATTERMOST_BOT_TOKEN and MATTERMOST_ALLOWED_USERS in .env.
//   3. Keep the Mattermost port forward running: blackberry/ssh-ec2.sh --forward
//
// Env vars:
//   MATTERMOST_BOT_TOKEN      required, the bot's access token
//   MATTERMOST_ALLOWED_USERS  required, comma-separated Mattermost usernames allowed to talk to the CTO
//   MATTERMOST_URL            default http://host.docker.internal:8065
//   OPENCODE_URL              default http://opencode-cto:4096
//   OPENCODE_SERVER_USERNAME / OPENCODE_SERVER_PASSWORD   basic auth for the OpenCode server
//   MATTERMOST_WEBHOOK_TOKEN  optional, the token Mattermost sends with slash commands / outgoing webhooks
//   PORT                      default 3000, Express listen port
//   CTO_AGENT (cto), BRIDGE_REPLY_TIMEOUT_MS (30 min), BRIDGE_STATE_FILE (/data/sessions.json)
import { createHash, timingSafeEqual } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import express from "express"
import { parseAllowed, splitMessage, stripMention, stripPrefix } from "./lib.mjs"

const MM_URL = (process.env.MATTERMOST_URL ?? "http://host.docker.internal:8065").replace(/\/$/, "")
console.log(MM_URL)
const MM_TOKEN = process.env.MATTERMOST_BOT_TOKEN ?? ""
const ALLOWED = parseAllowed(process.env.MATTERMOST_ALLOWED_USERS)
const OC_URL = (process.env.OPENCODE_URL ?? "http://opencode-cto:4096").replace(/\/$/, "")
const OC_AUTH =
  "Basic " +
  Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME ?? "opencode"}:${process.env.OPENCODE_SERVER_PASSWORD ?? ""}`).toString("base64")
const AGENT = process.env.CTO_AGENT ?? "cto"
const REPLY_TIMEOUT_MS = Number(process.env.BRIDGE_REPLY_TIMEOUT_MS ?? 30 * 60 * 1000)
const STATE_FILE = process.env.BRIDGE_STATE_FILE ?? "/data/sessions.json"
const ACK_AFTER_MS = 15 * 1000
const PORT = Number(process.env.PORT ?? 3000)
const WEBHOOK_TOKEN = process.env.MATTERMOST_WEBHOOK_TOKEN ?? ""

const log = (...args) => console.log(new Date().toISOString(), ...args)

if (!MM_TOKEN) {
  console.error("MATTERMOST_BOT_TOKEN is not set. Create a bot in Mattermost and put its token in .env.")
  process.exit(1)
}
if (ALLOWED.size === 0) {
  console.error("MATTERMOST_ALLOWED_USERS is empty. List the usernames allowed to talk to the CTO, comma-separated.")
  process.exit(1)
}

// ---- Mattermost REST ----

class HttpError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function mm(method, path, body) {
  const res = await fetch(`${MM_URL}/api/v4${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${MM_TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30 * 1000),
  })
  if (!res.ok) throw new HttpError(`Mattermost ${method} ${path} returned ${res.status}: ${await res.text()}`, res.status)
  return res.json()
}

const usernames = new Map()
async function usernameOf(userId) {
  if (!usernames.has(userId)) usernames.set(userId, (await mm("GET", `/users/${userId}`)).username)
  return usernames.get(userId)
}

async function post(channelId, rootId, message) {
  for (const part of splitMessage(message)) {
    await mm("POST", "/posts", { channel_id: channelId, root_id: rootId || "", message: part })
  }
}

// ---- OpenCode REST ----

async function oc(method, path, body) {
  const res = await fetch(`${OC_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: OC_AUTH },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
  })
  if (!res.ok) throw new HttpError(`OpenCode ${method} ${path} returned ${res.status}: ${await res.text()}`, res.status)
  return res.status === 204 ? null : res.json()
}

// ---- Conversation -> OpenCode session map, kept on disk so restarts keep context ----

let sessions = {}
try {
  sessions = JSON.parse(readFileSync(STATE_FILE, "utf8"))
} catch {}

function saveSessions() {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(sessions))
  } catch (err) {
    log("could not save session map:", err.message)
  }
}

async function newSession(key, title) {
  sessions[key] = (await oc("POST", "/api/session", { title: title.slice(0, 60), agent: AGENT })).data.id
  saveSessions()
  return sessions[key]
}

// OpenCode v2 is asynchronous: queue the prompt, wait for the session to go idle, then read the
// messages that arrived after our prompt. The list is newest first and ends the run with an
// "idle" entry carrying the outcome.
const MAX_WAITS = 5

async function runPrompt(id, text) {
  const promptId = (await oc("POST", `/api/session/${id}/prompt`, { text })).data.id
  for (let attempt = 0; attempt < MAX_WAITS; attempt++) {
    await oc("POST", `/api/experimental/session/${id}/wait`)
    const messages = (await oc("GET", `/api/session/${id}/message`)).data
    const ours = messages.filter((message) => message.id > promptId)
    const idle = ours.find((message) => message.type === "idle")
    if (idle) return { messages: ours, idle }
  }
  throw new Error("the CTO did not finish the request")
}

async function askCto(key, text) {
  let run
  try {
    run = await runPrompt(sessions[key] ?? (await newSession(key, text)), text)
  } catch (err) {
    // The session is gone, e.g. the cto-data volume was reset. Start a fresh one once.
    if (err.status !== 404) throw err
    run = await runPrompt(await newSession(key, text), text)
  }
  const final = run.messages.find((message) => message.type === "assistant" && message.content?.some((part) => part.type === "text"))
  const reply = (final?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
  const error = run.idle.error ? `\n\nCTO error: ${run.idle.error.message ?? JSON.stringify(run.idle.error)}` : ""
  return `${reply || "(The CTO returned no text.)"}${error}`
}

// One message at a time per conversation; different conversations run in parallel.
const chains = new Map()
function enqueue(key, job) {
  const next = (chains.get(key) ?? Promise.resolve()).catch(() => {}).then(job)
  chains.set(key, next)
  next.finally(() => chains.get(key) === next && chains.delete(key))
}

async function handle(channelId, rootId, key, text) {
  const typing = () => mm("POST", `/users/${bot.id}/typing`, { channel_id: channelId, parent_id: rootId }).catch(() => {})
  typing()
  const typingTimer = setInterval(typing, 4000)
  const ackTimer = setTimeout(
    () => post(channelId, rootId, "On it. The CTO may take a few minutes if the team has work to do.").catch(() => {}),
    ACK_AFTER_MS,
  )
  try {
    await post(channelId, rootId, await askCto(key, text))
  } catch (err) {
    log("request failed:", err.message)
    await post(channelId, rootId, `Sorry, I couldn't get an answer from the CTO: ${err.message}`).catch(() => {})
  } finally {
    clearInterval(typingTimer)
    clearTimeout(ackTimer)
  }
}

// ---- Incoming Mattermost events ----

const seen = new Set()

async function onPosted(data) {
  const msg = JSON.parse(data.post)
  if (msg.user_id === bot.id || msg.type || msg.props?.from_bot === "true") return // own, system and bot posts
  if (seen.has(msg.id)) return
  seen.add(msg.id)
  if (seen.size > 500) seen.delete(seen.values().next().value)

  const isDm = data.channel_type === "D"
  const mentioned = JSON.parse(data.mentions ?? "[]").includes(bot.id)
  if (!isDm && !mentioned) return

  const sender = await usernameOf(msg.user_id)
  const rootId = msg.root_id || (isDm ? "" : msg.id)
  if (!ALLOWED.has(sender.toLowerCase())) {
    log(`ignored message from ${sender}: not in MATTERMOST_ALLOWED_USERS`)
    await post(msg.channel_id, rootId, "Sorry, you're not on the list of people I take instructions from.")
    return
  }

  const text = stripMention(msg.message, bot.username)
  if (!text) return
  const key = msg.root_id || (isDm ? msg.channel_id : msg.id)

  if (text.toLowerCase() === "!new") {
    delete sessions[key]
    saveSessions()
    await post(msg.channel_id, rootId, "Started a new conversation. The CTO won't remember the earlier one.")
    return
  }

  log(`message from ${sender} in ${isDm ? "DM" : "channel"} (${key})`)
  enqueue(key, () => handle(msg.channel_id, rootId, key, text))
}

// ---- Websocket with reconnect ----

let bot
let socket
let connected = false
let retryMs = 1000
let seq = 1

function reconnect() {
  const old = socket
  socket = undefined
  connected = false
  try {
    old?.close()
  } catch {}
  setTimeout(connect, retryMs)
  retryMs = Math.min(retryMs * 2, 30 * 1000)
}

function connect() {
  const ws = new WebSocket(MM_URL.replace(/^http/, "ws") + "/api/v4/websocket")
  socket = ws
  let lastSeen = Date.now()
  let watchdog

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ seq: seq++, action: "authentication_challenge", data: { token: MM_TOKEN } }))
    watchdog = setInterval(() => {
      if (Date.now() - lastSeen > 90 * 1000) {
        log("websocket went quiet, reconnecting")
        clearInterval(watchdog)
        if (socket === ws) reconnect()
      } else {
        ws.send(JSON.stringify({ seq: seq++, action: "ping" }))
      }
    }, 30 * 1000)
  })

  ws.addEventListener("message", (event) => {
    lastSeen = Date.now()
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }
    if (msg.event === "hello") {
      connected = true
      retryMs = 1000
      log(`connected to ${MM_URL} as @${bot.username}`)
    } else if (msg.event === "posted") {
      onPosted(msg.data).catch((err) => log("could not handle post:", err.message))
    }
  })

  ws.addEventListener("close", () => {
    clearInterval(watchdog)
    if (socket !== ws) return
    connected = false
    log(`websocket closed, reconnecting in ${retryMs / 1000}s`)
    reconnect()
  })

  ws.addEventListener("error", () => {}) // a close event always follows
}

// ---- Express ----

const app = express()
app.disable("x-powered-by")

app.get("/health", (req, res) => {
  res.status(connected ? 200 : 503).json({
    status: connected ? "ok" : "disconnected",
    bot: bot?.username ?? null,
    conversations: Object.keys(sessions).length,
    uptimeSeconds: Math.round(process.uptime()),
  })
})

const digest = (value) => createHash("sha256").update(String(value ?? "")).digest()

if (WEBHOOK_TOKEN) {
  // Mattermost sends slash commands as form data and outgoing webhooks as form data or JSON.
  app.post("/mattermost/webhook", express.urlencoded({ extended: false, limit: "100kb" }), express.json({ limit: "100kb" }), async (req, res) => {
    const body = req.body ?? {}
    if (!timingSafeEqual(digest(body.token), digest(WEBHOOK_TOKEN))) return res.status(401).json({ error: "invalid token" })
    if (!bot) return res.status(503).json({ text: "The bridge is still connecting to Mattermost. Try again in a moment." })

    const sender = String(body.user_name ?? "")
    if (!ALLOWED.has(sender.toLowerCase())) {
      log(`ignored webhook from ${sender}: not in MATTERMOST_ALLOWED_USERS`)
      return res.json({ response_type: "ephemeral", text: "Sorry, you're not on the list of people I take instructions from." })
    }

    // Drop the trigger word of an outgoing webhook; slash commands arrive without the command itself.
    const text = stripPrefix(stripMention(String(body.text ?? ""), bot.username), String(body.trigger_word ?? ""))
    if (!text || !body.channel_id) return res.json({ response_type: "ephemeral", text: "Tell the CTO what you need after the command." })

    log(`webhook from ${sender} (${body.channel_id})`)
    const key = `webhook:${body.channel_id}:${body.user_id}`
    enqueue(key, () => handle(body.channel_id, "", key, text))
    // The answer is posted by the bot, so it must be a member of the channel.
    res.json({ response_type: "ephemeral", text: "On it. The CTO will answer in this channel." })
  })
}

app.use((err, req, res, next) => {
  log("express error:", err.message)
  res.status(400).json({ error: "bad request" })
})

const server = app.listen(PORT, () => log(`express listening on :${PORT}${WEBHOOK_TOKEN ? " (webhook enabled)" : ""}`))

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log(`${signal}, shutting down`)
    server.close()
    try {
      socket?.close()
    } catch {}
    process.exit(0)
  })
}

// ---- Start ----

for (;;) {
  try {
    bot = await mm("GET", "/users/me")
    break
  } catch (err) {
    if (err.status === 401) {
      console.error("Mattermost rejected MATTERMOST_BOT_TOKEN (401). Check the token in .env.")
      process.exit(1)
    }
    log(`waiting for Mattermost at ${MM_URL} (is the port forward running?): ${err.message}`)
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}
log(`bot is @${bot.username}; allowed users: ${[...ALLOWED].join(", ")}`)
connect()
