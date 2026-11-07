// Uses a named database row to coordinate the scheduler and Resource Manager.
import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import type { SharedLockInterface } from "../interfaces/shared-lock.interface.js"

// Both apps must use this exact name in the same database.
export const SCHEDULING_LOCK_NAME = "ticket-scheduling"

export class SharedLock implements SharedLockInterface {
  constructor(private readonly database: DatabaseSync) {}

  async tryAcquire(): Promise<string | null> {
    const owner = randomUUID()
    const result = this.database.prepare(`
      INSERT INTO locks (name, owner, acquired_at) VALUES (?, ?, ?)
      ON CONFLICT(name) DO NOTHING
    `).run(SCHEDULING_LOCK_NAME, owner, new Date().toISOString())
    return result.changes === 1 ? owner : null
  }

  async release(owner: string): Promise<void> {
    const result = this.database.prepare("DELETE FROM locks WHERE name = ? AND owner = ?")
      .run(SCHEDULING_LOCK_NAME, owner)
    if (result.changes !== 1) {
      throw new Error(`Could not release shared lock ${SCHEDULING_LOCK_NAME}: owner does not match`)
    }
  }
}
