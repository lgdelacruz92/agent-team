// Builds the request headers every opencode client needs, so the agent and its sessions authenticate the same way.
import { config } from "../config.js"

// Basic auth header for the opencode server. Empty when no password is configured.
export const opencodeHeaders = (): Record<string, string> => {
  if (!config.opencodePassword) {
    return {}
  }

  const credentials = Buffer.from(`${config.opencodeUser}:${config.opencodePassword}`).toString("base64")

  return { Authorization: `Basic ${credentials}` }
}
