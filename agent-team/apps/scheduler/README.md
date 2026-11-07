# Scheduler v2 scaffold

Estimated reading time: 9 minutes (150 WPM)

Standalone TypeScript Express app with SQLite persistence, local agent assignment, and Vikunja Kanban card movement. `index.ts` runs `Scheduler.runOnce()` continuously. Assignment reserves a local agent; it does not start an OpenCode session. Worker dispatch and completion handling are not implemented. The existing `frontend-ctr` stays separate.

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
- `SCHEDULER_POLL_MS`: wait after each completed pass, default `30000` (30 seconds). Must be an integer from 1 through 2147483647.
- `VIKUNJA_URL`: required server URL, without `/api/v1`.
- `VIKUNJA_API_TOKEN`: required API token.
- `VIKUNJA_PROJECT_ID`: required positive project ID.
- `VIKUNJA_VIEW_ID`: required positive Kanban view ID.

Export these Vikunja settings before `npm run dev` or `npm start`; this app does not automatically load `.env.local`. IDs and credentials have no working defaults.

The database directory and domain tables are created automatically. Database files are git-ignored. Keep the same database path to retain state across restarts.

## Endpoints

- `GET /health`: liveness check.

## Checks

```sh
npm test
npm run typecheck
npm run build
npm start
```

## Kanban ticket fetching

`src/components/vikunja.ts` reads one existing Kanban board. `index.ts` constructs the components from environment settings and starts `runSchedulerLoop` after the HTTP server begins listening. The first pass starts immediately; after every pass, the loop waits `SCHEDULER_POLL_MS` and repeats. Passes never overlap. Errors are logged and retried after the same wait; HTTP endpoints remain available.

SIGINT or SIGTERM stops the loop and cancels its polling wait. An active pass finishes before the SQLite connection closes. `Scheduler.runOnce()` remains one pass; repetition lives in `src/scheduler-loop.ts`.

`SchedulerDatabase.saveTicket()` creates or updates each fetched ticket by its Vikunja task ID, preserving its local ID and copying title, status, and priority exactly. Repeated saves do not create duplicates. Tickets absent from a fetch are not deleted.

`AgentManager.assignTicket()` chooses the first idle agent in local ID order with no incomplete assignment. `SchedulerDatabase.createAssignment()` records ownership and updates the local ticket in one SQLite transaction, without changing the agent's status. The scheduler then calls `Vikunja.markInProgress()`. No agent available means no assignment and no card movement. Missing or invalid connection settings prevent startup.

If card movement fails, the next pass reuses the ticket's existing incomplete assignment and retries the move instead of reserving another agent. A board refresh can temporarily reset the local ticket to Ready or Retry; it never clears the reservation. A successful later board fetch synchronizes its status.

For direct use, supply connection settings explicitly:

```ts
import { Vikunja } from "./src/components/vikunja.js"

const vikunja = new Vikunja({
  baseUrl: "https://your-vikunja-server", // Server URL, without /api/v1.
  token: process.env.VIKUNJA_API_TOKEN ?? "",
  projectId: 3, // Replace with your project's ID.
  viewId: 12, // Replace with your Kanban view's ID.
})

const tickets = await vikunja.getTickets()
```

Each result contains `vikunjaTaskId`, `title`, `status`, and `priority`. Column titles become statuses exactly as written: `Ready`, `In progress`, `Retry`, and `Done`. All columns are fetched; `SchedulerDatabase.getReadyTickets()` separately selects `Ready` and `Retry`.

Pagination uses each column's `count`, not the outer pagination header. Empty columns may contain `tasks: null`. Duplicate task IDs are returned once. Failed requests, invalid data, and stalled pagination throw rather than returning partial results. Multiple requests are not an atomic board snapshot; cards can move while pages are fetched.

Optional `perPage` defaults to 50; `timeoutMs` defaults to 30,000 milliseconds per request. Tests inject a fake `fetch` as the constructor's second argument. `getTickets()` does not write to either system.

`markInProgress()` reads the first board page to find exactly one column titled `In progress`, then posts the task to that bucket in the configured project/view. Column discovery does not need every card page. Missing, differently capitalized, duplicate, or malformed destinations fail before the write. HTTP, network, and timeout failures propagate; HTTP errors omit response bodies and credentials. Each call resolves the column ID again.

## Local agents and assignments

The scheduler assumes the `agents` table is already populated with valid real agent IDs and states. Provisioning those agents and populating the table are outside this app's scope. `agents.id` is the real ID the watcher uses to identify the agent; no separate external ID is planned. Startup does not create agents, probe OpenCode servers, or load a worker list. A fresh database therefore keeps polling without assigning anything.

For local testing, an agent can be inserted through `AgentStore`, for example:

```ts
const database = openDatabase("data/scheduler.sqlite")
try {
  new AgentStore(database).create({ name: "frontend-1", status: "idle" })
} finally {
  database.close()
}
```

Use the imports shown below. This example generates an ID locally; it does not provision a real agent or ensure the generated ID matches one. The name is not an OpenCode endpoint. Do not run it every pass; agent names are not unique.

### Intended watcher contract

The database is intended to be the source of truth for system state. A separate app will watch the agent and assignment records and reconcile the real agent resources with the desired state. The scheduler records assignments; it does not start or monitor agents or update agent status. The watcher is intended to report real agent status and observed progress back to the database, using `assignments.agent_id` to find the real agent by `agents.id`. A saved assignment alone is not proof that an agent is running. An incomplete assignment reserves the agent even while its status remains `idle`.

One possible future flow is for the scheduler to record `assigned`, then for the watcher to report `running` after confirming startup and `completed` or `failed` after work ends. The exact lifecycle and write ownership still need implementation. The watcher is not implemented here, and the current scheduler writes `running` immediately as described below.

- `idle`: eligible, provided the agent has no assignment whose `completedAt` is null.
- `busy`: ineligible for new assignments. The scheduler does not set this status; the future watcher is responsible for reporting agent status. Other status strings are excluded.
- Assignment `running`: bookkeeping for active ownership, not proof that an AI worker is executing.
- Completion: still manual through the stores until the watcher exists. Set the assignment's completion timestamp and report the agent as idle only when its work is actually finished. Moving the board card to Done alone does not release the reservation.

`SchedulerDatabase` now receives the shared SQLite connection and constructs its own stores. `AgentManager` receives the scheduler database, AgentStore, and AssignmentStore on that same connection. Transactions recheck persisted ticket readiness and agent availability and reject duplicate active ownership. Raw stores remain low-level CRUD and can bypass these scheduling rules.

The SQLite transaction cannot include the external Vikunja request. Local ownership remains saved if the move fails; the polling loop logs the failure and retries later. Persistent movement failures can stall the first ready ticket. Recovery/backoff, worker dispatch, and completion monitoring remain future work.

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

The stores currently let SQLite generate IDs, including `agents.id`; they do not verify that an agent ID identifies a real resource. IDs use JavaScript numbers within the safe integer range. Timestamps use ISO 8601 strings; new assignments default to the current UTC time and a null completion time. Status values remain unrestricted strings.

Foreign keys prevent orphan assignments and deletion of referenced tickets or agents. Delete assignments explicitly first. The stores do not impose scheduling rules.

The scheduling loop uses a shared connection for domain stores; those stores have no HTTP routes.
