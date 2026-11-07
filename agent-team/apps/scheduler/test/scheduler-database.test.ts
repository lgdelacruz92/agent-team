// Checks how the scheduler saves tickets and reads ready tickets from its local database.
import assert from "node:assert/strict"
import { test } from "node:test"
import { SchedulerDatabase } from "../src/components/scheduler-database.js"
import { openDatabase } from "../src/db/database.js"
import { TicketStore } from "../src/db/ticket-store.js"

test("saveTicket creates a local ticket with every supplied field", async () => {
  const database = openDatabase(":memory:")

  try {
    const tickets = new TicketStore(database)
    const schedulerDatabase = new SchedulerDatabase(database)
    const input = { vikunjaTaskId: 42, title: "Build a form", status: "Retry", priority: 3 }

    const saved = await schedulerDatabase.saveTicket(input)

    assert.ok(Number.isSafeInteger(saved.id) && saved.id > 0)
    assert.notEqual(saved.id, input.vikunjaTaskId)
    assert.deepEqual({ ...saved }, { id: saved.id, ...input })
    assert.deepEqual(tickets.get(saved.id), saved)
    assert.deepEqual(await schedulerDatabase.getReadyTickets(), [saved])
  } finally {
    database.close()
  }
})

test("saveTicket updates by Vikunja ID, preserving the local ID and other tickets", async () => {
  const database = openDatabase(":memory:")

  try {
    const tickets = new TicketStore(database)
    const schedulerDatabase = new SchedulerDatabase(database)
    const other = tickets.create({ vikunjaTaskId: 41, title: "Other", status: "Ready", priority: 1 })
    const existing = tickets.create({ vikunjaTaskId: 42, title: "Old title", status: "Retry", priority: 2 })
    const input = { vikunjaTaskId: 42, title: "New title", status: "In progress", priority: 5 }

    const saved = await schedulerDatabase.saveTicket(input)

    assert.deepEqual({ ...saved }, { id: existing.id, ...input })
    assert.deepEqual(tickets.list(), [other, saved])
    assert.deepEqual(await schedulerDatabase.getReadyTickets(), [other])
  } finally {
    database.close()
  }
})

test("saveTicket repeatedly saves the same task without creating duplicates", async () => {
  const database = openDatabase(":memory:")

  try {
    const tickets = new TicketStore(database)
    const schedulerDatabase = new SchedulerDatabase(database)
    const input = { vikunjaTaskId: 42, title: "Build a form", status: "Done", priority: 0 }

    const first = await schedulerDatabase.saveTicket(input)
    const second = await schedulerDatabase.saveTicket(input)
    const third = await schedulerDatabase.saveTicket(input)

    assert.deepEqual(second, first)
    assert.deepEqual(third, first)
    assert.deepEqual(tickets.list(), [first])
  } finally {
    database.close()
  }
})

test("saveTicket rejects database failures rather than reporting success", async () => {
  const database = openDatabase(":memory:")
  const schedulerDatabase = new SchedulerDatabase(database)
  database.close()

  await assert.rejects(schedulerDatabase.saveTicket({
    vikunjaTaskId: 42, title: "Build a form", status: "Ready", priority: 1,
  }), /database is not open/)
})

test("getReadyTickets returns an empty list when no tickets are ready", async () => {
  const database = openDatabase(":memory:")

  try {
    const tickets = new TicketStore(database)
    const schedulerDatabase = new SchedulerDatabase(database)

    assert.deepEqual(await schedulerDatabase.getReadyTickets(), [])

    tickets.create({ vikunjaTaskId: 1, title: "Working", status: "In progress", priority: 1 })
    assert.deepEqual(await schedulerDatabase.getReadyTickets(), [])
  } finally {
    database.close()
  }
})

test("getReadyTickets returns Ready and Retry tickets in local ID order without changing their statuses", async () => {
  const database = openDatabase(":memory:")

  try {
    const tickets = new TicketStore(database)
    const schedulerDatabase = new SchedulerDatabase(database)

    const first = tickets.create({ vikunjaTaskId: 10, title: "First", status: "Ready", priority: 1 })
    tickets.create({ vikunjaTaskId: 11, title: "Under review", status: "Review", priority: 2 })
    const retry = tickets.create({ vikunjaTaskId: 12, title: "Retry", status: "Retry", priority: 3 })
    tickets.create({ vikunjaTaskId: 13, title: "Lowercase", status: "ready", priority: 4 })
    const second = tickets.create({ vikunjaTaskId: 14, title: "Second", status: "Ready", priority: 5 })
    tickets.create({ vikunjaTaskId: 15, title: "Working", status: "In progress", priority: 1 })
    tickets.create({ vikunjaTaskId: 16, title: "Finished", status: "Done", priority: 1 })
    tickets.create({ vikunjaTaskId: 17, title: "Lowercase retry", status: "retry", priority: 1 })

    assert.deepEqual(await schedulerDatabase.getReadyTickets(), [first, retry, second])
    assert.equal(tickets.get(retry.id)?.status, "Retry")
  } finally {
    database.close()
  }
})
