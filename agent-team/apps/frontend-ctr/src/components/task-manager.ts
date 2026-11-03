// Turns Vikunja kanban tickets into TaskInterface objects the scheduler understands.
// It is the bridge between the Vikunja service and the scheduler, so neither needs to know about the other.

import { config } from "../config.js"
import type { TaskInterface } from "../interfaces/task.interface.js"
import type { TaskManagerInterface } from "../interfaces/taskmanager.interface.js"
import type { VikunjaServiceInterface } from "../interfaces/vikunja.service.interface.js"
import type { VikunjaTaskInterface } from "../interfaces/vikunja.types.js"

// Converts a Vikunja ticket into the shape the scheduler and workers use.
const toTask = (ticket: VikunjaTaskInterface): TaskInterface => {
  return {
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
  }
}

// Reads tickets from Vikunja through the service it is given, so tests can pass a fake service.
export class TaskManager implements TaskManagerInterface {
  constructor(private readonly vikunja: VikunjaServiceInterface) {}

  // Tasks waiting to be started.
  getReadyTasks(): Promise<TaskInterface[]> {
    return this.tasksIn(config.buckets.ready)
  }

  // Tasks a worker is working on right now.
  getInProgressTasks(): Promise<TaskInterface[]> {
    return this.tasksIn(config.buckets.inProgress)
  }

  // Tasks whose work is finished and waiting for review.
  getReviewTasks(): Promise<TaskInterface[]> {
    return this.tasksIn(config.buckets.review)
  }

  // Tasks that should be tried again.
  getRetryTasks(): Promise<TaskInterface[]> {
    return this.tasksIn(config.buckets.retry)
  }

  // Tasks that are complete.
  getDoneTasks(): Promise<TaskInterface[]> {
    return this.tasksIn(config.buckets.done)
  }

  // Reads one kanban column through the service and converts its tickets, in the order Vikunja returns them.
  private async tasksIn(column: string): Promise<TaskInterface[]> {
    const tickets = await this.vikunja.getTasks(column)

    return tickets.map(toTask)
  }
}
