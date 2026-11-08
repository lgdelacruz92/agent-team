// Reads the settings for the Resource Manager's agent-check loop.
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Resolve relative to the app, not the directory from which it was started.
const defaultDatabasePath = fileURLToPath(new URL("../../shared-db/db.sqlite", import.meta.url))
const _databasePath = process.env.RESOURCE_MANAGER_DB_PATH ?? defaultDatabasePath
const _pollMs = Number(process.env.RESOURCE_MANAGER_POLL_MS ?? "30000")
const _opencodeUser = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
const _opencodePassword = process.env.OPENCODE_SERVER_PASSWORD ?? ""
const _executionTimeoutMs = process.env.RESOURCE_MANAGER_EXECUTION_TIMEOUT_MS === undefined
  ? null : Number(process.env.RESOURCE_MANAGER_EXECUTION_TIMEOUT_MS)

if (!_databasePath) {
  throw new Error("RESOURCE_MANAGER_DB_PATH must point to the existing shared database")
}

if (!Number.isInteger(_pollMs) || _pollMs < 1 || _pollMs > 2_147_483_647) {
  throw new Error("RESOURCE_MANAGER_POLL_MS must be an integer between 1 and 2147483647")
}
if (_executionTimeoutMs !== null && (!Number.isSafeInteger(_executionTimeoutMs) || _executionTimeoutMs < 1)) {
  throw new Error("RESOURCE_MANAGER_EXECUTION_TIMEOUT_MS must be a positive safe integer")
}

// The shared OpenCode credentials match the existing frontend controller.
const headers: Record<string, string> = {}
if (_opencodePassword) {
  const credentials = Buffer.from(`${_opencodeUser}:${_opencodePassword}`).toString("base64")
  headers.Authorization = `Basic ${credentials}`
}

export const config = {
  databasePath: resolve(_databasePath),
  pollMs: _pollMs,
  opencodeHeaders: headers,
  executionTimeoutMs: _executionTimeoutMs,
  vikunja: {
    baseUrl: process.env.VIKUNJA_URL ?? "",
    token: process.env.VIKUNJA_API_TOKEN ?? "",
    projectId: Number(process.env.VIKUNJA_PROJECT_ID ?? "0"),
    viewId: Number(process.env.VIKUNJA_VIEW_ID ?? "0"),
  },
}
