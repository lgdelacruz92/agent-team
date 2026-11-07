// Creates a controlled scheduler schema for tests only, not application startup.
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { openDatabase } from "../../src/db/database.js"
import { seedSharedTables } from "../../src/db/seed-shared.js"

export function createTestDatabase(path = ":memory:"): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  const database = new DatabaseSync(path)
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tickets (
      id INTEGER PRIMARY KEY,
      vikunja_task_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL,
      present_on_board INTEGER NOT NULL DEFAULT 0 CHECK (present_on_board IN (0, 1))
    ) STRICT;
    CREATE TABLE agents (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id),
      agent_id INTEGER NOT NULL REFERENCES agents(id),
      status TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      completed_at TEXT
    ) STRICT;
    CREATE INDEX assignments_ticket_id ON assignments(ticket_id);
    CREATE INDEX assignments_agent_id ON assignments(agent_id);
  `)
  seedSharedTables(database)
  if (path === ":memory:") return database
  database.close()
  return openDatabase(path)
}
