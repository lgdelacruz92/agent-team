// Explicitly set up shared coordination tables in an existing scheduler database.
import { resolve } from "node:path"
import { openDatabase } from "./db/database.js"
import { seedSharedTables } from "./db/seed-shared.js"

const path = process.argv[2]
if (!path || process.argv.length !== 3 || path === ":memory:") {
  throw new Error("Usage: npm run seed -- <path-to-existing-scheduler-database>")
}

const databasePath = resolve(path)
const database = openDatabase(databasePath)
try {
  seedSharedTables(database)
  console.log(`Shared executions and locks tables are ready in ${databasePath}`)
} finally {
  database.close()
}
