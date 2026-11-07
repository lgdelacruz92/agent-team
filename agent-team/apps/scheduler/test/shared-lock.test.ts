// Checks coordination between independent SQLite connections.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { SharedLock, SCHEDULING_LOCK_NAME } from "../src/components/shared-lock.js"
import { AgentManager } from "../src/components/agent-manager.js"
import { Scheduler } from "../src/components/scheduler.js"
import { SchedulerDatabase } from "../src/components/scheduler-database.js"
import { AgentStore } from "../src/db/agent-store.js"
import { AssignmentStore } from "../src/db/assignment-store.js"
import { openDatabase } from "../src/db/database.js"
import { createTestDatabase } from "./fixtures/database.js"

test("shared lock prevents competing owners and only its owner can release it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scheduler-lock-test-"))
  const path = join(directory, "scheduler.sqlite")
  const first = createTestDatabase(path)
  const second = openDatabase(path)
  try {
    const lock1 = new SharedLock(first)
    const lock2 = new SharedLock(second)
    const owner = await lock1.tryAcquire()
    assert.ok(owner)
    assert.equal(await lock2.tryAcquire(), null)
    await assert.rejects(lock2.release("not-the-owner"), /owner does not match/)
    assert.equal(second.prepare("SELECT owner FROM locks WHERE name = ?").get(SCHEDULING_LOCK_NAME)?.owner, owner)
    await lock1.release(owner)
    const next = await lock2.tryAcquire()
    assert.ok(next)
    assert.notEqual(next, owner)
    await lock2.release(next)
  } finally {
    second.close()
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("lock database errors are not mistaken for contention", async () => {
  const database = createTestDatabase()
  try {
    database.exec("DROP TABLE locks")
    await assert.rejects(new SharedLock(database).tryAcquire(), /no such table/)
  } finally {
    database.close()
  }
})

test("scheduler holds the lock while a board fetch is in flight", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scheduler-lock-pass-test-"))
  const path = join(directory, "scheduler.sqlite")
  const first = createTestDatabase(path)
  const second = openDatabase(path)
  try {
    let finishFetch!: () => void
    let startedFetch!: () => void
    const fetchStarted = new Promise<void>((resolve) => { startedFetch = resolve })
    const fetchMayFinish = new Promise<void>((resolve) => { finishFetch = resolve })
    const schedulerDatabase = new SchedulerDatabase(first)
    const scheduler = new Scheduler({
      async getTickets() { startedFetch(); await fetchMayFinish; return [] },
      async moveToFlagged() { assert.fail("no move expected") },
    }, schedulerDatabase, new AgentManager(schedulerDatabase, new AgentStore(first), new AssignmentStore(first)), new SharedLock(first), 3)
    const pass = scheduler.runOnce()
    await fetchStarted
    const otherLock = new SharedLock(second)
    assert.equal(await otherLock.tryAcquire(), null)
    finishFetch()
    await pass
    const owner = await otherLock.tryAcquire()
    assert.ok(owner)
    await otherLock.release(owner)
  } finally {
    second.close()
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("scheduler does not fetch the board while another connection owns the lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scheduler-lock-held-test-"))
  const path = join(directory, "scheduler.sqlite")
  const first = createTestDatabase(path)
  const second = openDatabase(path)
  try {
    const otherLock = new SharedLock(first)
    const owner = await otherLock.tryAcquire()
    assert.ok(owner)
    let fetched = false
    const schedulerDatabase = new SchedulerDatabase(second)
    const scheduler = new Scheduler({
      async getTickets() { fetched = true; return [] },
      async moveToFlagged() { assert.fail("no move expected") },
    }, schedulerDatabase, new AgentManager(schedulerDatabase, new AgentStore(second), new AssignmentStore(second)), new SharedLock(second), 3)
    await scheduler.runOnce()
    assert.equal(fetched, false)
    await otherLock.release(owner)
    await scheduler.runOnce()
    assert.equal(fetched, true)
  } finally {
    second.close()
    first.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
