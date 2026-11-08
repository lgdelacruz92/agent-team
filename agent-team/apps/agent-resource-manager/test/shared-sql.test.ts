// Checks the manual shared SQL scripts using an isolated in-memory database.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { seedSharedTables } from "../../scheduler/src/db/seed-shared.js"
import { AgentDatabase } from "../src/components/agent-database.js"

const seed = readFileSync(new URL("../../shared-db/seed.sql", import.meta.url), "utf8")
const drop = readFileSync(new URL("../../shared-db/drop.sql", import.meta.url), "utf8")

test("manual seed creates both apps' schema and leaves agent provisioning to a human", async () => {
  const database = new DatabaseSync(":memory:")
  try {
    database.exec(seed)
    seedSharedTables(database)
    const agents = new AgentDatabase(database)
    assert.deepEqual(await agents.listAgents(), [])

    database.exec("INSERT INTO agents (name, status, url) VALUES ('frontend', 'idle', 'http://frontend')")
    assert.equal((await agents.listAgents())[0].url, "http://frontend")
    database.exec("INSERT INTO tickets (vikunja_task_id, title, status, priority) VALUES (10, 'test', 'Ready', 1)")
    database.exec("INSERT INTO assignments (ticket_id, agent_id, status, assigned_at) VALUES (1, 1, 'assigned', 'now')")
    database.exec("INSERT INTO executions (assignment_id, status, created_at) VALUES (1, 'starting', 'now')")
    assert.throws(() => database.exec("INSERT INTO assignments (ticket_id, agent_id, status, assigned_at) VALUES (999, 1, 'assigned', 'now')"), /FOREIGN KEY/)
    assert.throws(() => database.exec("INSERT INTO tickets (vikunja_task_id, title, status, priority) VALUES (10, 'duplicate', 'Ready', 1)"), /UNIQUE/)
  } finally {
    database.close()
  }
})

test("manual drop removes shared tables with data but leaves unrelated tables intact", () => {
  const database = new DatabaseSync(":memory:")
  try {
    database.exec(seed)
    database.exec("CREATE TABLE unrelated (id INTEGER)")
    database.exec("INSERT INTO agents (name, status, url) VALUES ('frontend', 'idle', 'http://frontend')")
    database.exec("INSERT INTO tickets (vikunja_task_id, title, status, priority) VALUES (10, 'test', 'Ready', 1)")
    database.exec("INSERT INTO assignments (ticket_id, agent_id, status, assigned_at) VALUES (1, 1, 'assigned', 'now')")
    database.exec("INSERT INTO executions (assignment_id, status, created_at) VALUES (1, 'starting', 'now')")
    database.exec(drop)

    const names = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all()
    assert.deepEqual(names.map((row) => row.name), ["unrelated"])
  } finally {
    database.close()
  }
})
