// Contract for sending requests to the Vikunja API.

// Sends requests to Vikunja and returns their HTTP responses for the service to interpret.
export interface VikunjaAPIInterface {
  get(path: string): Promise<Response>
  post(path: string, body: unknown): Promise<Response>
  put(path: string, body: unknown): Promise<Response>
}
