// Checks scheduler configuration in isolated processes.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

function readConfig(value?: string) {
  const env = { ...process.env }
  if (value === undefined) delete env.SCHEDULER_ASSIGNMENT_WARNING_MS
  else env.SCHEDULER_ASSIGNMENT_WARNING_MS = value
  return spawnSync(process.execPath, [
    "--import", "tsx", "--input-type=module", "-e",
    "import { config } from './src/config.ts'; console.log(config.assignmentWarningMs)",
  ], { env, encoding: "utf8" })
}

test("assignment warning interval defaults to 10 minutes and accepts an override", () => {
  const defaults = readConfig()
  assert.equal(defaults.status, 0)
  assert.equal(defaults.stdout.trim(), "600000")
  const custom = readConfig("120000")
  assert.equal(custom.status, 0)
  assert.equal(custom.stdout.trim(), "120000")
})

test("assignment warning interval rejects invalid values", () => {
  for (const value of ["0", "-1", "1.5", "invalid", "9007199254740992"]) {
    const result = readConfig(value)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /SCHEDULER_ASSIGNMENT_WARNING_MS must be a positive safe integer/)
  }
})

function readMaxAttempts(value?: string) {
  const env = { ...process.env }
  if (value === undefined) delete env.SCHEDULER_MAX_ATTEMPTS
  else env.SCHEDULER_MAX_ATTEMPTS = value
  return spawnSync(process.execPath, [
    "--import", "tsx", "--input-type=module", "-e",
    "import { config } from './src/config.ts'; console.log(config.maxAttempts)",
  ], { env, encoding: "utf8" })
}

test("maximum attempts defaults to three and accepts an override", () => {
  const defaults = readMaxAttempts()
  assert.equal(defaults.status, 0)
  assert.equal(defaults.stdout.trim(), "3")
  const custom = readMaxAttempts("5")
  assert.equal(custom.status, 0)
  assert.equal(custom.stdout.trim(), "5")
})

test("maximum attempts rejects invalid values", () => {
  for (const value of ["", "0", "-1", "1.5", "invalid", "9007199254740992"]) {
    const result = readMaxAttempts(value)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /SCHEDULER_MAX_ATTEMPTS must be a positive safe integer/)
  }
})
