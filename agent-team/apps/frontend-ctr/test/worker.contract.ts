// Contract tests for WorkerInterface. Every worker implementation runs this same suite, so the Controller can
// rely on the behaviour below without knowing which worker it holds. It is not a *.test.ts file on purpose:
// vitest only runs it when an implementation's own test file calls workerContract().
import { describe, expect, it } from "vitest"
import type { VikunjaTaskInterface } from "../src/interfaces/vikunja.interface.js"
import type { WorkerInterface } from "../src/interfaces/worker.interface.js"

// A minimal ticket to start a run with. Only the fields the prompt is built from matter.
const task: VikunjaTaskInterface = {
  id: 1,
  title: "Contract test ticket",
  description: "Does nothing. Used to open a session.",
  done: false,
  due_date: "",
  labels: [],
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

    describe("isAlive", () => {
      it("answers with a boolean and does not throw, so an outage is a value and not an error", async () => {
        const worker = await makeWorker()

        expect(typeof (await worker.isAlive())).toBe("boolean")
      })
    })

    describe("create", () => {
      it("returns a non-empty session id", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(task)

        expect(sessionId).toEqual(expect.any(String))
        expect(sessionId.length).toBeGreaterThan(0)

        await worker.delete(sessionId)
      })

      it("returns a different session id for each call", async () => {
        const worker = await makeWorker()
        const first = await worker.create(task)
        const second = await worker.create(task)

        expect(first).not.toBe(second)

        await worker.delete(first)
        await worker.delete(second)
      })
    })

    describe("checks on a session", () => {
      it("answers every check with a boolean", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(task)

        expect(typeof (await worker.isDone(sessionId))).toBe("boolean")
        expect(typeof (await worker.isStale(sessionId, Date.now()))).toBe("boolean")
        expect(typeof (await worker.isBusy(sessionId))).toBe("boolean")
        expect(typeof (await worker.isProgressing(sessionId))).toBe("boolean")

        await worker.delete(sessionId)
      })

      it("is never both done and busy, because done means the session is idle", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(task)
        const done = await worker.isDone(sessionId)
        const busy = await worker.isBusy(sessionId)

        expect(done && busy).toBe(false)

        await worker.delete(sessionId)
      })

      it("is not done right after create, because the agent has not answered yet", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(task)

        expect(await worker.isDone(sessionId)).toBe(false)

        await worker.delete(sessionId)
      })
    })

    describe("isStale", () => {
      it("is not stale when the run has only just started", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(task)

        expect(await worker.isStale(sessionId, Date.now())).toBe(false)

        await worker.delete(sessionId)
      })

      it("is stale when the run started far longer ago than any time budget", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(task)
        const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000

        expect(await worker.isStale(sessionId, Date.now() - tenYearsMs)).toBe(true)

        await worker.delete(sessionId)
      })
    })

    describe("abort", () => {
      it("stops the turn and leaves the session usable for the checks", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(task)

        await expect(worker.abort(sessionId)).resolves.toBeUndefined()
        await expect(worker.isBusy(sessionId)).resolves.toBe(false)

        await worker.delete(sessionId)
      })
    })

    describe("delete", () => {
      it("deletes a session", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(task)

        await expect(worker.delete(sessionId)).resolves.toBeUndefined()
      })

      it("treats a session that is already gone as deleted, so the cleanup queue can retry safely", async () => {
        const worker = await makeWorker()
        const sessionId = await worker.create(task)

        await worker.delete(sessionId)

        await expect(worker.delete(sessionId)).resolves.toBeUndefined()
      })
    })
  })
}
