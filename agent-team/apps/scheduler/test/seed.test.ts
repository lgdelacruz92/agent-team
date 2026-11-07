// Exercises the explicit shared-table seed against disposable databases only.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { seedSharedTables } from "../src/db/seed-shared.js"
import { createTestDatabase } from "./fixtures/database.js"

test("seeding creates shared tables and can be repeated without changing existing data", () => {
  const database = createTestDatabase()
  try {
    database.exec("DROP TABLE executions; DROP TABLE locks")
    seedSharedTables(database)
    database.prepare("INSERT INTO locks (name, owner, acquired_at) VALUES (?, ?, ?)")
      .run("held", "owner", "2026-01-01")
    seedSharedTables(database)
    assert.equal(database.prepare("SELECT owner FROM locks WHERE name = 'held'").get()?.owner, "owner")
    assert.ok(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'executions'").get())
  } finally {
    database.close()
  }
})

test("seeding rejects incompatible existing tables and rolls back new tables", () => {
  const database = createTestDatabase()
  try {
    database.exec("DROP TABLE executions; DROP TABLE locks; CREATE TABLE locks (name TEXT PRIMARY KEY)")
    assert.throws(() => seedSharedTables(database), /missing column owner/)
    assert.equal(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'executions'").get(), undefined)
    assert.ok(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'locks'").get())
  } finally {
    database.close()
  }
})

test("seed command requires an existing database and creates its shared tables", () => {
  const directory = mkdtempSync(join(tmpdir(), "scheduler-seed-test-"))
  const path = join(directory, "scheduler.sqlite")
  try {
    const missing = spawnSync(process.execPath, ["--import", "tsx", "src/seed.ts", path], { encoding: "utf8" })
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /database does not exist/)
    const database = createTestDatabase(path)
    database.exec("DROP TABLE executions; DROP TABLE locks")
    database.close()
    const seeded = spawnSync(process.execPath, ["--import", "tsx", "src/seed.ts", path], { encoding: "utf8" })
    assert.equal(seeded.status, 0, seeded.stderr)
    assert.match(seeded.stdout, /Shared executions and locks tables are ready/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
