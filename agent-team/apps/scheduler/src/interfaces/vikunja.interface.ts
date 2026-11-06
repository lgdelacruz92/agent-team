// Defines the ticket information the scheduler exchanges with Vikunja.

// The Vikunja ID is distinct from the local database ticket ID.
export interface VikunjaTicket {
  vikunjaTaskId: number
  title: string
  status: string
  priority: number
}

export interface VikunjaInterface {
  // Fetch tickets for the scheduler to sync into its database.
  getTickets(): Promise<VikunjaTicket[]>

  // Mark the Vikunja task in progress after its local assignment is confirmed.
  markInProgress(vikunjaTaskId: number): Promise<void>
}
