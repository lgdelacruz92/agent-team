// Defines the ticket information the scheduler exchanges with Vikunja.

// The Vikunja ID is distinct from the local database ticket ID.
export interface VikunjaTicket {
  vikunjaTaskId: number
  title: string
  status: string
  priority: number
}

export interface VikunjaInterface {
  // Fetch every card from the configured Kanban board; column titles are ticket statuses.
  getTickets(): Promise<VikunjaTicket[]>
}
