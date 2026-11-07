// Checks how the scheduler reads ready tickets from its local database.
import assert from "node:assert/strict"
import { test } from "node:test"
import { SchedulerDatabase } from "../src/components/scheduler-database.js"
import { openDatabase } from "../src/db/database.js"
import { TicketStore } from "../src/db/ticket-store.js"

test("getReadyTickets returns an empty list when no tickets are ready", async () => {
  const database = openDatabase(":memory:")

  try {
    const tickets = new TicketStore(database)
    const schedulerDatabase = new SchedulerDatabase(tickets)

    assert.deepEqual(await schedulerDatabase.getReadyTickets(), [])

    tickets.create({ vikunjaTaskId: 1, title: "Working", status: "In progress", priority: 1 })
    assert.deepEqual(await schedulerDatabase.getReadyTickets(), [])
  } finally {
    database.close()
  }
})

test("getReadyTickets returns only Ready tickets in local ID order", async () => {
  const database = openDatabase(":memory:")

  try {
    const tickets = new TicketStore(database)
    const schedulerDatabase = new SchedulerDatabase(tickets)

    const first = tickets.create({ vikunjaTaskId: 10, title: "First", status: "Ready", priority: 1 })
    tickets.create({ vikunjaTaskId: 11, title: "Under review", status: "Review", priority: 2 })
    tickets.create({ vikunjaTaskId: 12, title: "Retry", status: "Retry", priority: 3 })
    tickets.create({ vikunjaTaskId: 13, title: "Lowercase", status: "ready", priority: 4 })
    const second = tickets.create({ vikunjaTaskId: 14, title: "Second", status: "Ready", priority: 5 })

    assert.deepEqual(await schedulerDatabase.getReadyTickets(), [first, second])
  } finally {
    database.close()
  }
})
