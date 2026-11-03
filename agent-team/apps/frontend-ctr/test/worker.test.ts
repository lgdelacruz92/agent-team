import { describe, expect, it, vi } from "vitest"
import { OpencodeWorker } from "../src/components/opencode-worker.js"
import type {
  OpencodeAgentInterface,
  OpencodeAgentState,
  OpencodeMessageInterface,
  OpencodeSessionInterface,
} from "../src/interfaces/opencode-agent.interface.js"
import { workerContract } from "./worker.contract.js"

// An in-memory agent, so the contract runs without an opencode server.
// A session is busy from its prompt until it is aborted, and keeps its messages until it is deleted.
class FakeAgent implements OpencodeAgentInterface {
  readonly name = "fake"

  private count = 0
  private busy = new Set<string>()
  private sessions = new Map<string, OpencodeMessageInterface[]>()

  async state(): Promise<OpencodeAgentState> {
    if (this.busy.size > 0) {
      return "busy"
    }

    return "idle"
  }

  async isDone(sessionId: string): Promise<boolean> {
    return !this.busy.has(sessionId) && this.known(sessionId).length > 0
  }

  async isStale(_sessionId: string, _startedAt: number): Promise<boolean> {
    return false
  }

  async isProgressing(_sessionId: string): Promise<boolean> {
    return true
  }

  async createSession(_title: string): Promise<OpencodeSessionInterface> {
    this.count += 1

    const id = `ses_${this.count}`

    this.sessions.set(id, [])

    return { id }
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    const messages = this.known(sessionId)

    messages.push({ id: `msg_${messages.length + 1}`, role: "user", text })
    this.busy.add(sessionId)
  }

  async waitForIdle(sessionId: string, _timeoutMs: number): Promise<boolean> {
    this.known(sessionId)

    return !this.busy.has(sessionId)
  }

  async abort(sessionId: string): Promise<void> {
    this.known(sessionId)
    this.busy.delete(sessionId)
  }

  async messages(sessionId: string): Promise<OpencodeMessageInterface[]> {
    return this.known(sessionId)
  }

  // Throws for an unknown id, like the real agent does.
  async deleteSession(sessionId: string): Promise<void> {
    this.known(sessionId)
    this.sessions.delete(sessionId)
    this.busy.delete(sessionId)
  }

  async clearSessions(): Promise<void> {
    this.sessions.clear()
    this.busy.clear()
  }

  private known(sessionId: string): OpencodeMessageInterface[] {
    const messages = this.sessions.get(sessionId)

    if (!messages) {
      throw new Error(`fake has no session ${sessionId}`)
    }

    return messages
  }
}

describe("OpencodeWorker", () => {
  workerContract("OpencodeWorker", () => new OpencodeWorker("frontend-1", ["react"], new FakeAgent()))

  it("is not available when the agent is unreachable", async () => {
    const agent = new FakeAgent()

    vi.spyOn(agent, "state").mockResolvedValue("unreachable")

    const worker = new OpencodeWorker("frontend-1", ["react"], agent)

    expect(await worker.isAvailable()).toBe(false)
  })
})
