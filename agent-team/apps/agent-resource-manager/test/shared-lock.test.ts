// Stale locks warn a human without releasing another process's reservation.
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { SharedLock } from "../src/components/shared-lock.js"

for (const name of ["ticket-scheduling", "resource-manager-pass"]) {
  test(`${name} warns only after two minutes and remains held`, async (t) => {
    const database = new DatabaseSync(":memory:")
    t.after(() => database.close())
    database.exec("CREATE TABLE locks (name TEXT PRIMARY KEY, owner TEXT NOT NULL, acquired_at TEXT NOT NULL)")
    const warnings = t.mock.method(console, "warn", () => {})
    let now = Date.parse("2026-01-01T00:00:00.000Z")
    const first = new SharedLock(database, name, () => new Date(now))
    const second = new SharedLock(database, name, () => new Date(now))
    const owner = await first.tryAcquire()
    assert.ok(owner)

    now += 120_000
    assert.equal(await second.tryAcquire(), null)
    assert.equal(warnings.mock.callCount(), 0)

    now += 1
    assert.equal(await second.tryAcquire(), null)
    assert.equal(warnings.mock.callCount(), 1)
    assert.match(String(warnings.mock.calls[0].arguments[0]), /human review/)
    assert.equal(database.prepare("SELECT owner FROM locks WHERE name = ?").get(name)?.owner, owner)

    await first.release(owner)
    assert.ok(await second.tryAcquire())
  })
}

test("warns about an invalid acquisition time without modifying the lock", async (t) => {
  const database = new DatabaseSync(":memory:")
  t.after(() => database.close())
  database.exec("CREATE TABLE locks (name TEXT PRIMARY KEY, owner TEXT NOT NULL, acquired_at TEXT NOT NULL)")
  database.prepare("INSERT INTO locks VALUES (?, ?, ?)").run("ticket-scheduling", "other-owner", "invalid")
  const warnings = t.mock.method(console, "warn", () => {})
  await new SharedLock(database).warnIfStale()
  assert.match(String(warnings.mock.calls[0].arguments[0]), /invalid acquisition time/)
  assert.equal(database.prepare("SELECT owner FROM locks").get()?.owner, "other-owner")
})
