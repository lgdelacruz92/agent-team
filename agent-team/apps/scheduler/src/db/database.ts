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
        priority INTEGER NOT NULL,
        present_on_board INTEGER NOT NULL DEFAULT 0 CHECK (present_on_board IN (0, 1))
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

    // Existing databases have no presence information until the next successful sync.
    database.exec("BEGIN IMMEDIATE")
    try {
      const columns = database.prepare("PRAGMA table_info(tickets)").all()
      if (!columns.some((column) => column.name === "present_on_board")) {
        database.exec("ALTER TABLE tickets ADD COLUMN present_on_board INTEGER NOT NULL DEFAULT 0 CHECK (present_on_board IN (0, 1))")
      }
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  } catch (error) {
    database.close()
    throw error
  }

  return database
}
