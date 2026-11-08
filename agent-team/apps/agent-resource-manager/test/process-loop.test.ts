// Tests the repeating loop without starting a real manager or agent.
import assert from "node:assert/strict"
import { test } from "node:test"
import { runProcessLoop } from "../src/process-loop.js"

test("runs passes without overlap and stops after shutdown", async () => {
  const controller = new AbortController()
  let calls = 0
  let active = false
  const manager = {
    async runOnce() {
      assert.equal(active, false)
      active = true
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      active = false
      if (calls === 2) controller.abort()
    },
  }

  await runProcessLoop(manager, 1, controller.signal)
  assert.equal(calls, 2)
})

test("retries after a failed pass", async (t) => {
  t.mock.method(console, "error", () => {})
  const controller = new AbortController()
  let calls = 0
  const manager = {
    async runOnce() {
      calls += 1
      if (calls === 1) throw new Error("pass failed")
      controller.abort()
    },
  }

  await runProcessLoop(manager, 1, controller.signal)
  assert.equal(calls, 2)
})
