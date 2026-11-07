// Checks repetition, error recovery, non-overlap, and shutdown of the caller's loop.
import assert from "node:assert/strict"
import { setImmediate } from "node:timers/promises"
import { test } from "node:test"
import { runSchedulerLoop } from "../src/scheduler-loop.js"

// Let breakpoint pauses take as long as needed; normal test runs keep their timeout.
const testTimeout = process.env.SCHEDULER_TEST_DEBUG === "1" ? undefined : 2000

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

test("the loop repeats successful and failed passes without overlapping", { timeout: testTimeout }, async () => {
  const controller = new AbortController()
  const error = new Error("Pass failed")
  const errors: unknown[] = []
  let calls = 0
  let running = false

  await runSchedulerLoop({
    async runOnce() {
      assert.equal(running, false)
      running = true
      calls += 1
      await setImmediate()
      running = false
      if (calls === 1) {
        throw error
      }
      if (calls === 3) {
        controller.abort()
      }
    },
  }, 1, controller.signal, (failure) => errors.push(failure))

  assert.equal(calls, 3)
  assert.deepEqual(errors, [error])
})

test("aborting the polling wait stops promptly instead of waiting for the next interval", { timeout: testTimeout }, async () => {
  const controller = new AbortController()
  const called = deferred()
  let calls = 0
  const loop = runSchedulerLoop({
    async runOnce() {
      calls += 1
      called.resolve()
    },
  }, 60_000, controller.signal)

  await called.promise
  await setImmediate()
  controller.abort()
  await loop
  assert.equal(calls, 1)
})

test("shutdown waits for an active pass and does not start another", { timeout: testTimeout }, async () => {
  const controller = new AbortController()
  const started = deferred()
  const finish = deferred()
  let calls = 0
  let stopped = false
  const loop = runSchedulerLoop({
    async runOnce() {
      calls += 1
      started.resolve()
      await finish.promise
    },
  }, 1, controller.signal).then(() => { stopped = true })

  await started.promise
  controller.abort()
  await setImmediate()
  assert.equal(stopped, false)
  finish.resolve()
  await loop
  assert.equal(stopped, true)
  assert.equal(calls, 1)
})

test("an already stopped loop does not start a pass", async () => {
  const controller = new AbortController()
  controller.abort()
  await runSchedulerLoop({ async runOnce() { assert.fail("No pass should start") } }, 1, controller.signal)
})

test("assignment checks continue even when scheduling passes fail", async () => {
  const controller = new AbortController()
  let checks = 0
  let passes = 0
  const errors: unknown[] = []
  await runSchedulerLoop({
    async runOnce() {
      passes += 1
      if (passes === 2) controller.abort()
      throw new Error("board unavailable")
    },
  }, 1, controller.signal, (error) => errors.push(error), () => { checks += 1 })
  assert.equal(checks, 2)
  assert.equal(errors.length, 2)
})

test("a failed assignment check is reported but does not stop scheduling", async () => {
  const controller = new AbortController()
  const errors: unknown[] = []
  const failure = new Error("cannot inspect assignments")
  let passes = 0
  await runSchedulerLoop({
    async runOnce() { passes += 1; controller.abort() },
  }, 1, controller.signal, undefined, () => { throw failure }, (error) => errors.push(error))
  assert.equal(passes, 1)
  assert.deepEqual(errors, [failure])
})
