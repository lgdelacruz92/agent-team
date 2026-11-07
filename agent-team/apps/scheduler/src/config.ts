// Reads configuration for the standalone scheduler scaffold.
import { resolve } from "node:path"

const _host = process.env.HOST ?? "127.0.0.1"
const _port = Number(process.env.PORT ?? "3300")
const _databasePath = resolve(process.env.SCHEDULER_DB_PATH ?? "data/scheduler.sqlite")

if (!Number.isInteger(_port) || _port < 1 || _port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535")
}

export const config = {
  host: _host,
  port: _port,
  databasePath: _databasePath,

  // Required when index.ts constructs the client for the startup scheduling pass.
  vikunja: {
    baseUrl: process.env.VIKUNJA_URL ?? "",
    token: process.env.VIKUNJA_API_TOKEN ?? "",
    projectId: Number(process.env.VIKUNJA_PROJECT_ID ?? "0"),
    viewId: Number(process.env.VIKUNJA_VIEW_ID ?? "0"),
  },
}
