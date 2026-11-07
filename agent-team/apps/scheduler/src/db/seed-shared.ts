// Creates the new shared tables only when a person explicitly runs the seed script.
import type { DatabaseSync } from "node:sqlite"

function checkSharedTables(database: DatabaseSync): void {
  for (const [table, required] of [
    ["executions", ["id", "assignment_id", "session_id", "status", "created_at", "work_requested_at", "started_at", "finished_at", "failure_reason"]],
    ["locks", ["name", "owner", "acquired_at"]],
  ] as const) {
    const tableRow = database.prepare("SELECT type FROM sqlite_schema WHERE name = ?").get(table)
    if (tableRow?.type !== "table") throw new Error(`${table} must be a table`)
    const columns = database.prepare(`PRAGMA table_info(${table})`).all()
    for (const column of required) {
      if (!columns.some((item) => item.name === column)) {
        throw new Error(`Existing ${table} table is missing column ${column}; no automatic migration was performed`)
      }
    }
    const key = table === "locks" ? "name" : "id"
    if (!columns.some((item) => item.name === key && item.pk === 1)
      || columns.filter((item) => typeof item.pk === "number" && item.pk > 0).length !== 1) {
      throw new Error(`Existing ${table} table must have ${key} as its sole primary key`)
    }
    for (const column of table === "locks" ? ["owner", "acquired_at"] : ["assignment_id", "status", "created_at"]) {
      if (!columns.some((item) => item.name === column && item.notnull === 1)) {
        throw new Error(`Existing ${table}.${column} must be NOT NULL`)
      }
    }
    if (table === "executions") {
      for (const column of ["session_id", "work_requested_at", "started_at", "finished_at", "failure_reason"]) {
        if (!columns.some((item) => item.name === column && item.notnull === 0)) {
          throw new Error(`Existing executions.${column} must allow NULL`)
        }
      }
    }
  }
  const foreignKeys = database.prepare("PRAGMA foreign_key_list(executions)").all()
  if (!foreignKeys.some((key) => key.table === "assignments" && key.from === "assignment_id" && key.to === "id")) {
    throw new Error("Existing executions.assignment_id must reference assignments.id")
  }
}

export function seedSharedTables(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE")
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS executions (
        id INTEGER PRIMARY KEY,
        assignment_id INTEGER NOT NULL REFERENCES assignments(id),
        session_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        work_requested_at TEXT,
        started_at TEXT,
        finished_at TEXT,
        failure_reason TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS locks (
        name TEXT PRIMARY KEY NOT NULL,
        owner TEXT NOT NULL,
        acquired_at TEXT NOT NULL
      ) STRICT;
    `)
    checkSharedTables(database)
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}
