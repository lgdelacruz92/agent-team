import { describe, expect, it } from "vitest"
import { select } from "../src/components/select.js"
import type { Ticket } from "../src/interfaces/ticket.js"

const ticket = (id: number, over: Partial<Ticket> = {}): Ticket => ({
  id,
  title: `t${id}`,
  description: "Acceptance criteria: it works",
  dueDate: null,
  status: "ready",
  goal: 1,
  blockers: [],
  blockingCount: 0,
  failures: 0,
  ...over,
})
const ids = (tickets: Ticket[]) => select(tickets, { maxFailures: 3 }).queue.map((t) => t.id)

describe("select", () => {
  it("only takes Ready and Retry tickets", () => {
    expect(ids([ticket(1, { status: "inProgress" }), ticket(2, { status: "review" }), ticket(3, { status: "done" }), ticket(4, { status: null }), ticket(5)])).toEqual([5])
  })

  it("waits for blockers to be Done; Review still blocks", () => {
    const tickets = [
      ticket(1, { blockers: [{ id: 9, status: "review" }] }),
      ticket(2, { blockers: [{ id: 9, status: "done" }, { id: 8, status: "done" }] }),
      ticket(3, { blockers: [{ id: 7, status: null }] }),
    ]
    expect(ids(tickets)).toEqual([2])
  })

  it("orders Retry first, then lowest GOAL-N, most dependents, lowest id", () => {
    const tickets = [
      ticket(1, { goal: 2 }),
      ticket(2, { goal: 1 }),
      ticket(3, { goal: 1, blockingCount: 2 }),
      ticket(4, { goal: 3, status: "retry" }),
      ticket(5, { goal: null }),
      ticket(6, { goal: 1 }),
    ]
    expect(ids(tickets)).toEqual([4, 3, 2, 6, 1, 5])
  })

  it("skips tickets without acceptance criteria and says why", () => {
    const { queue, skipped } = select([ticket(1, { description: "do something" }), ticket(2)], { maxFailures: 3 })
    expect(queue.map((t) => t.id)).toEqual([2])
    expect(skipped).toEqual([{ id: 1, title: "t1", reason: "the description has no acceptance criteria" }])
  })

  it("skips a ticket that failed too many times", () => {
    const { queue, skipped } = select([ticket(1, { failures: 3 }), ticket(2, { failures: 2 })], { maxFailures: 3 })
    expect(queue.map((t) => t.id)).toEqual([2])
    expect(skipped[0].reason).toBe("failed 3 times")
  })
})
