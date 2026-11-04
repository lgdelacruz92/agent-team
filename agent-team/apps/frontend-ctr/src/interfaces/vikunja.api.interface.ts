// Contract for sending requests to the Vikunja API.

// Sends a JSON body to a Vikunja endpoint and returns its HTTP response.
export interface VikunjaAPIInterface {
  put(path: string, body: unknown): Promise<Response>
}
