// Checks scheduler configuration in isolated processes.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

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

test("database defaults to the shared db.sqlite regardless of working directory and allows an override", () => {
  const env = { ...process.env }
  delete env.SCHEDULER_DB_PATH
  const directory = fileURLToPath(new URL("../../shared-db/", import.meta.url))
  const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href
  const source = new URL("../src/config.ts", import.meta.url).href
  const args = ["--import", loader, "--input-type=module", "-e", `import { config } from ${JSON.stringify(source)}; console.log(config.databasePath)`]

  const defaults = spawnSync(process.execPath, args, { cwd: directory, env, encoding: "utf8" })
  assert.equal(defaults.status, 0, defaults.stderr)
  assert.equal(defaults.stdout.trim(), resolve(directory, "db.sqlite"))

  env.SCHEDULER_DB_PATH = "another.sqlite"
  const custom = spawnSync(process.execPath, args, { cwd: directory, env, encoding: "utf8" })
  assert.equal(custom.status, 0, custom.stderr)
  assert.equal(custom.stdout.trim(), resolve(directory, "another.sqlite"))
})
