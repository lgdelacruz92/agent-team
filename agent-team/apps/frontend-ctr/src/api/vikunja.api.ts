// Sends authenticated HTTP requests to the Vikunja API.
import type { VikunjaAPIInterface } from "../interfaces/vikunja.api.interface.js"
import { config } from "../config.js"

// Centralizes the URL, authentication and timeout used for Vikunja requests.
export class VikunjaAPI implements VikunjaAPIInterface {
  constructor(
    private readonly baseUrl = config.vikunjaUrl,
    private readonly token = config.vikunjaToken,
    private readonly timeoutMs = config.vikunjaTimeoutMs,
    private readonly viewId = config.viewId,
    private readonly projectId = config.projectId,
  ) {}

  // Sends the caller's body as JSON, leaving response handling to the service.
  async put(path: string, body: unknown): Promise<Response> {
    return await fetch(`${this.baseUrl}/api/v1${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
  }
}
