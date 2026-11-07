// Tracks pass outcomes in memory without changing scheduling behavior.
import type { SchedulerInterface } from "../interfaces/scheduler.interface.js"

export interface SchedulerStatusSnapshot {
  running: boolean
  lastSucceededAt: string | null
  lastFailedAt: string | null
  lastResult: "success" | "failure" | null
}

export class SchedulerStatus implements SchedulerInterface {
  private status: SchedulerStatusSnapshot = {
    running: false,
    lastSucceededAt: null,
    lastFailedAt: null,
    lastResult: null,
  }

  constructor(
    private readonly scheduler: SchedulerInterface,
    private readonly now: () => Date = () => new Date(),
  ) {}

  snapshot(): SchedulerStatusSnapshot {
    return { ...this.status }
  }

  async runOnce(): Promise<void> {
    this.status.running = true
    try {
      await this.scheduler.runOnce()
      this.status.lastSucceededAt = this.now().toISOString()
      this.status.lastResult = "success"
    } catch (error) {
      this.status.lastFailedAt = this.now().toISOString()
      this.status.lastResult = "failure"
      throw error
    } finally {
      this.status.running = false
    }
  }
}
