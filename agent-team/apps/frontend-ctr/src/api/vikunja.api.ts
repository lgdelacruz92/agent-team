// Sends authenticated HTTP requests to the Vikunja API.
import type { VikunjaAPIInterface } from "../interfaces/vikunja.api.interface.js"
import { config } from "../config.js"

// Centralizes the URL, authentication and timeout used for Vikunja requests.
export class VikunjaAPI implements VikunjaAPIInterface {
  constructor(
    private readonly baseUrl = config.vikunjaUrl,
    private readonly token = config.vikunjaToken,
    private readonly timeoutMs = config.vikunjaTimeoutMs,
  ) {}

  // Retrieves a resource, leaving response handling to the service.
  get(path: string): Promise<Response> {
    return this.request("GET", path)
  }

  // Sends the caller's body as JSON.
  post(path: string, body: unknown): Promise<Response> {
    return this.request("POST", path, body)
  }

  // Sends the caller's body as JSON.
  put(path: string, body: unknown): Promise<Response> {
    return this.request("PUT", path, body)
  }

  // All requests share the same API prefix, credentials and timeout.
  private request(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` }
    const options: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    }

    if (method !== "GET") {
      headers["Content-Type"] = "application/json"
      options.body = JSON.stringify(body)
    }

    return fetch(`${this.baseUrl}/api/v1${path}`, options)
  }
}
