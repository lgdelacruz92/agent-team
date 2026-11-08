// The scheduler uses this same row and owner-token protocol.
import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

const staleAfterMs = 2 * 60_000

export class SharedLock {
  constructor(
    private readonly database: DatabaseSync,
    private readonly name = "ticket-scheduling",
    private readonly now: () => Date = () => new Date(),
  ) {}

  async tryAcquire(): Promise<string | null> {
    const owner = randomUUID()
    const result = this.database.prepare("INSERT INTO locks (name, owner, acquired_at) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING")
      .run(this.name, owner, this.now().toISOString())
    if (result.changes !== 1) await this.warnIfStale()
    return result.changes === 1 ? owner : null
  }

  // Warn only; removing a lock while its owner is still working could create overlap.
  async warnIfStale(): Promise<void> {
    const row = this.database.prepare("SELECT acquired_at FROM locks WHERE name = ?").get(this.name)
    if (!row) return
    const acquiredAt = typeof row.acquired_at === "string" ? Date.parse(row.acquired_at) : NaN
    if (!Number.isFinite(acquiredAt)) {
      console.warn(`Lock ${this.name} has an invalid acquisition time; human review is required`)
    } else if (this.now().getTime() - acquiredAt > staleAfterMs) {
      console.warn(`Lock ${this.name} has been held for over 2 minutes and may be stale; human review is required`)
    }
  }

  async release(owner: string): Promise<void> {
    const result = this.database.prepare("DELETE FROM locks WHERE name = ? AND owner = ?").run(this.name, owner)
    if (result.changes !== 1) throw new Error(`Could not release ${this.name} lock: owner does not match`)
  }
}
