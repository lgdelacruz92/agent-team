# Scheduler v2 scaffold

Estimated reading time: 2 minutes (150 WPM)

Standalone TypeScript Express app with SQLite persistence. No scheduling, worker dispatch, or Vikunja integration yet. The existing `frontend-ctr` stays separate.

## Run

Requires Node.js 22.13+ for built-in `node:sqlite` (experimental on some Node versions).

From `apps/scheduler`:

```sh
npm install
npm run dev
```

Defaults to `http://127.0.0.1:3300`. No authentication: keep it local.

## Configuration

- `HOST`: default `127.0.0.1`.
- `PORT`: default `3300`.
- `SCHEDULER_DB_PATH`: default `data/scheduler.sqlite`, relative to the working directory.

The database directory and table are created automatically. Database files are git-ignored. Keep the same database path to retain state across restarts.

## Endpoints

- `GET /health`: liveness check.
- `PUT /state/:key`: save JSON using a body containing `value`.
- `GET /state/:key`: retrieve saved JSON; missing keys return 404.

```sh
curl -X PUT http://127.0.0.1:3300/state/example \
  -H 'Content-Type: application/json' \
  -d '{"value":{"paused":true}}'
curl http://127.0.0.1:3300/state/example
```

## Checks

```sh
npm test
npm run typecheck
npm run build
npm start
```

## Table stores

`src/db/stores-doc.md` defines the three domain tables:

- `TicketStore`: tickets, including a unique Vikunja task ID.
- `AgentStore`: agents and their status.
- `AssignmentStore`: ticket-to-agent history and timestamps.

Open one shared connection and pass it to each store:

```ts
import { openDatabase } from "./src/db/database.js"
import { TicketStore } from "./src/db/ticket-store.js"
import { AgentStore } from "./src/db/agent-store.js"
import { AssignmentStore } from "./src/db/assignment-store.js"

const database = openDatabase("data/scheduler.sqlite")
const tickets = new TicketStore(database)
const agents = new AgentStore(database)
const assignments = new AssignmentStore(database)

// Close only after every store is finished.
database.close()
```

Each store exposes `create`, `get`, `list`, `update`, and `delete`. Updates replace all mutable fields; missing records return `undefined`. Deletion returns whether a record was removed.

SQLite generates local IDs. IDs use JavaScript numbers within the safe integer range. Timestamps use ISO 8601 strings; new assignments default to the current UTC time and a null completion time. Status values remain unrestricted strings.

Foreign keys prevent orphan assignments and deletion of referenced tickets or agents. Delete assignments explicitly first. The stores do not impose scheduling rules.

The existing HTTP endpoints still use `StateStore` for generic JSON state. Table stores have no HTTP routes or scheduling integration yet.
