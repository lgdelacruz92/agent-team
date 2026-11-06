// Stores JSON state in SQLite so values survive application restarts.
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

// A small key/value store; no ticket or worker schema is imposed yet.
export class StateStore {
  private readonly database: DatabaseSync

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true })
    }

    this.database = new DatabaseSync(path)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  // Missing keys return undefined; persisted JSON null remains a valid value.
  get(key: string): unknown {
    const row = this.database.prepare("SELECT value FROM state WHERE key = ?").get(key)

    if (!row) {
      return undefined
    }

    return JSON.parse(row.value as string)
  }

  // Inserts or replaces one value using bound parameters, not interpolated SQL.
  set(key: string, value: unknown): void {
    const serialized = JSON.stringify(value)

    if (serialized === undefined) {
      throw new Error("State must be JSON-serializable")
    }

    this.database.prepare(`
      INSERT INTO state (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, serialized)
  }

  // Releases the database connection during shutdown or test cleanup.
  close(): void {
    this.database.close()
  }
}
