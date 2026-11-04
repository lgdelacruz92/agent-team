// Contract tests for WorkerInterface. Every worker implementation runs this same suite, so the Controller can
// rely on the behaviour below without knowing which worker it holds. It is not a *.test.ts file on purpose:
// vitest only runs it when an implementation's own test file calls workerContract().
import { describe, expect, it } from "vitest"
import type { TicketInterface } from "../src/interfaces/ticket.interface.js"
import type { WorkerInterface } from "../src/interfaces/worker.interface.js"

// A minimal ticket to start a run with. Only the fields the prompt is built from matter.
const ticket: TicketInterface = {
  ticketId: 1,
  title: "Contract test ticket",
  description: "Does nothing. Used to open a session.",
  getLabels: async () => [],
  toTask: () => { throw new Error("not used") },
}

// Runs the WorkerInterface contract against the worker that `makeWorker` returns.
// `makeWorker` is called once per test so that no test sees another test's sessions.
export const workerContract = (name: string, makeWorker: () => WorkerInterface | Promise<WorkerInterface>) => {
  describe(`${name} satisfies WorkerInterface`, () => {
    describe("identity", () => {
      it("has a non-empty id", async () => {
        const worker = await makeWorker()

        expect(worker.id).toEqual(expect.any(String))
        expect(worker.id.length).toBeGreaterThan(0)
      })

      it("lists its skills as strings", async () => {
        const worker = await makeWorker()

        expect(Array.isArray(worker.skills)).toBe(true)

        for (const skill of worker.skills) {
          expect(skill).toEqual(expect.any(String))
        }
      })
    })

    describe("isAvailable", () => {
      it("answers with a boolean and does not throw, so an outage is a value and not an error", async () => {
        const worker = await makeWorker()

        expect(typeof (await worker.isAvailable())).toBe("boolean")
      })

      it("is not available while a ticket is running, and is again after abort", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(ticket)

        expect(await worker.isAvailable()).toBe(false)

        await worker.abort(sessionId)

        expect(await worker.isAvailable()).toBe(true)

        await worker.delete(sessionId)
      })
    })

    describe("create", () => {
      it("returns a non-empty session id", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(ticket)

        expect(sessionId).toEqual(expect.any(String))
        expect(sessionId.length).toBeGreaterThan(0)

        await worker.delete(sessionId)
      })

      it("returns a different session id for each call", async () => {
        const worker = await makeWorker()
        const first = await worker.create(ticket)
        const second = await worker.create(ticket)

        expect(first).not.toBe(second)

        await worker.delete(first)
        await worker.delete(second)
      })
    })

    describe("abort", () => {
      it("stops the turn and leaves the session usable for the checks", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(ticket)

        await expect(worker.abort(sessionId)).resolves.toBeUndefined()
        await expect(worker.isAvailable()).resolves.toBe(true)

        await worker.delete(sessionId)
      })
    })

    describe("delete", () => {
      it("deletes a session", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(ticket)

        await expect(worker.delete(sessionId)).resolves.toBeUndefined()
      })

      it("treats a session that is already gone as deleted, so the cleanup queue can retry safely", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(ticket)

        await worker.delete(sessionId)

        await expect(worker.delete(sessionId)).resolves.toBeUndefined()
      })
    })
  })
}
