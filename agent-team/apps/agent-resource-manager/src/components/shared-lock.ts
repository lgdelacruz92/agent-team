// The scheduler uses this same row and owner-token protocol.
import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

export class SharedLock {
  constructor(private readonly database: DatabaseSync, private readonly name = "ticket-scheduling") {}

  async tryAcquire(): Promise<string | null> {
    const owner = randomUUID()
    const result = this.database.prepare("INSERT INTO locks (name, owner, acquired_at) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING")
      .run(this.name, owner, new Date().toISOString())
    return result.changes === 1 ? owner : null
  }

  async release(owner: string): Promise<void> {
    const result = this.database.prepare("DELETE FROM locks WHERE name = ? AND owner = ?").run(this.name, owner)
    if (result.changes !== 1) throw new Error(`Could not release ${this.name} lock: owner does not match`)
  }
}
