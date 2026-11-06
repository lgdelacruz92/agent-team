// Opens the shared SQLite connection and creates the schema from stores-doc.md.
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

// The caller owns this connection and closes it after all stores are finished.
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true })
  }

  const database = new DatabaseSync(path)

  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY,
        vikunja_task_id INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS assignments (
        id INTEGER PRIMARY KEY,
        ticket_id INTEGER NOT NULL REFERENCES tickets(id),
        agent_id INTEGER NOT NULL REFERENCES agents(id),
        status TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS assignments_ticket_id ON assignments(ticket_id);
      CREATE INDEX IF NOT EXISTS assignments_agent_id ON assignments(agent_id);
    `)
  } catch (error) {
    database.close()
    throw error
  }

  return database
}
