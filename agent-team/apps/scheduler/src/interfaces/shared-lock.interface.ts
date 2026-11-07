// Coordinates a scheduling pass with other apps using the shared database.
export interface SharedLockInterface {
  // Return an owner token, or null when another process holds the lock.
  tryAcquire(): Promise<string | null>
  // Only the owner can release the lock.
  release(owner: string): Promise<void>
}
