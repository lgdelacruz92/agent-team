// Turns Vikunja kanban tickets into TaskInterface objects the scheduler understands.
// It is the bridge between the Vikunja service and the scheduler, so neither needs to know about the other.

import type { TaskInterface } from "../interfaces/task.interface.js"
import type { TaskColumn, TaskManagerInterface } from "../interfaces/taskmanager.interface.js"
import type { VikunjaServiceInterface } from "../interfaces/vikunja.service.interface.js"
import { vikunjaColumns } from "../interfaces/vikunja.types.js"
import type { VikunjaColumn, VikunjaTaskInterface } from "../interfaces/vikunja.types.js"

// Converts a Vikunja ticket into the shape the scheduler and workers use.
const toTask = (ticket: VikunjaTaskInterface): TaskInterface => {
  return {
    ticketId: ticket.id,
    title: ticket.title,
    description: ticket.description,
  }
}

// Reads tickets from Vikunja through the service it is given, so tests can pass a fake service.
export class TaskManager implements TaskManagerInterface {
  constructor(private readonly vikunja: VikunjaServiceInterface) {}

  // Tasks a worker can pick up now: the unblocked tasks in Ready followed by the tasks in Retry.
  // Retry tasks are not checked for blockers: they were already started once.
  async getTasks(): Promise<TaskInterface[]> {
    const ready = await this.vikunja.getReadyUnblockedTickets()
    const retry = await this.vikunja.getTickets(vikunjaColumns.retry)

    return [...ready, ...retry].map(toTask)
  }

  // Tasks waiting to be started.
  getReadyTasks(): Promise<TaskInterface[]> {
    return this.tasksIn(vikunjaColumns.ready)
  }

  // Tasks a worker is working on right now.
  getInProgressTasks(): Promise<TaskInterface[]> {
    return this.tasksIn(vikunjaColumns.inProgress)
  }

  // Tasks whose work is finished and waiting for review.
  getReviewTasks(): Promise<TaskInterface[]> {
    return this.tasksIn(vikunjaColumns.review)
  }

  // Tasks that should be tried again.
  getRetryTasks(): Promise<TaskInterface[]> {
    return this.tasksIn(vikunjaColumns.retry)
  }

  // Tasks that are complete.
  getDoneTasks(): Promise<TaskInterface[]> {
    return this.tasksIn(vikunjaColumns.done)
  }

  // Vikunja identifies tasks by number, even though other task sources may use string IDs.
  async moveTo(ticketId: TaskInterface["ticketId"], column: TaskColumn): Promise<void> {
    if (typeof ticketId !== "number") {
      throw new Error(`Vikunja task ID must be a number: ${ticketId}`)
    }

    await this.vikunja.moveToColumn(ticketId, column)
  }

  // Reads one kanban column through the service and converts its tickets, in the order Vikunja returns them.
  private async tasksIn(column: VikunjaColumn): Promise<TaskInterface[]> {
    const tickets = await this.vikunja.getTickets(column)

    return tickets.map(toTask)
  }
}
