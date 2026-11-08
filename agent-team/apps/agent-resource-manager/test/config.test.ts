// Checks database path configuration without opening a real database.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

test("database defaults to the shared db.sqlite regardless of working directory and allows an override", () => {
  const env = { ...process.env }
  delete env.RESOURCE_MANAGER_DB_PATH
  const directory = fileURLToPath(new URL("../../shared-db/", import.meta.url))
  const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href
  const source = new URL("../src/config.ts", import.meta.url).href
  const args = ["--import", loader, "--input-type=module", "-e", `import { config } from ${JSON.stringify(source)}; console.log(config.databasePath)`]

  const defaults = spawnSync(process.execPath, args, { cwd: directory, env, encoding: "utf8" })
  assert.equal(defaults.status, 0, defaults.stderr)
  assert.equal(defaults.stdout.trim(), resolve(directory, "db.sqlite"))

  env.RESOURCE_MANAGER_DB_PATH = "another.sqlite"
  const custom = spawnSync(process.execPath, args, { cwd: directory, env, encoding: "utf8" })
  assert.equal(custom.status, 0, custom.stderr)
  assert.equal(custom.stdout.trim(), resolve(directory, "another.sqlite"))
})
