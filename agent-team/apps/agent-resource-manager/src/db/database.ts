// Opens a prepared shared database without creating tables or running migrations.
import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

// The caller closes the database after the current pass finishes.
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:" && !existsSync(path)) {
    throw new Error(`Resource Manager database does not exist: ${path}`)
  }

  const database = new DatabaseSync(path)

  try {
    database.prepare("SELECT id, name, status, url FROM agents LIMIT 0")
    database.exec("PRAGMA busy_timeout = 5000")
  } catch (error) {
    database.close()
    throw new Error("Shared database must have an agents table with id, name, status, and url columns", { cause: error })
  }

  return database
}
