// Opens an existing shared SQLite database; schema setup belongs outside the app.
import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

// The caller owns this connection and closes it after all stores are finished.
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:" && !existsSync(path)) {
    throw new Error(`Scheduler database does not exist: ${path}. Set up the shared database before starting the scheduler.`)
  }

  const database = new DatabaseSync(path)

  try {
    // Check the columns used by the current scheduler without creating or changing tables.
    database.prepare("SELECT id, vikunja_task_id, title, status, priority, present_on_board FROM tickets LIMIT 0")
    database.prepare("SELECT id, name, status FROM agents LIMIT 0")
    database.prepare("SELECT id, ticket_id, agent_id, status, assigned_at, completed_at FROM assignments LIMIT 0")
  } catch (error) {
    database.close()
    throw new Error("Scheduler database schema is missing or incompatible. Set up the shared database before starting the scheduler.", { cause: error })
  }

  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
    `)
  } catch (error) {
    database.close()
    throw error
  }

  return database
}
