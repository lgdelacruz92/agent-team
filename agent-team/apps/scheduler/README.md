# Scheduler v2 scaffold

Estimated reading time: 11 minutes (150 WPM)

Standalone TypeScript Express app with SQLite persistence, local agent assignment, and Vikunja Kanban fetching. `index.ts` runs `Scheduler.runOnce()` continuously. Assignment reserves a local agent; it does not start an OpenCode session or move a card. The future resource manager will handle agent execution and card movement; it is not implemented. The existing `frontend-ctr` stays separate.

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
- `SCHEDULER_ASSIGNMENT_WARNING_MS`: age at which to warn about an incomplete `assigned` record, and minimum time between repeated warnings. Default `600000` (10 minutes); must be a positive safe integer.
- `SCHEDULER_MAX_ATTEMPTS`: total attempts allowed, including the first; defaults to `3` and must be a positive safe integer. This setting is not enforced yet: execution counting and retry-limit checks remain unimplemented.
- `VIKUNJA_URL`: required server URL, without `/api/v1`.
- `VIKUNJA_API_TOKEN`: required API token.
- `VIKUNJA_PROJECT_ID`: required positive project ID.
- `VIKUNJA_VIEW_ID`: required positive Kanban view ID.

Export these Vikunja settings before `npm run dev` or `npm start`; this app does not automatically load `.env.local`. IDs and credentials have no working defaults.

The database and tables must already exist; the scheduler does not create or migrate them. See [database setup](docs/setup.md). Database files are git-ignored. Keep the same database path to retain state across restarts.

## Endpoints

- `GET /health`: liveness check.
- `GET /status`: scheduling pass status. Returns `running`, `lastSucceededAt`, `lastFailedAt`, and `lastResult` (`success`, `failure`, or `null`). Times are UTC ISO strings; timestamps and result are `null` until the corresponding event occurs. While a pass is running, `lastResult` describes the previous completed pass.

`/status` returns HTTP 200 even when the last pass failed; inspect the fields and logs to assess progress. A successful pass may find no tickets or available agents, and assignment warning-check failures are logged separately. Status is held in memory and resets when the app restarts. `/health` remains a process-liveness check, not a scheduler or watcher health check.

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

`SchedulerDatabase.syncTickets()` atomically reconciles a complete successful fetch: it creates or updates tickets by Vikunja task ID, preserving local IDs and copying title, status, and priority exactly. Fetched tickets have `present_on_board = 1`; missing tickets have `present_on_board = 0` and remain in the database along with their assignments. Missing tickets are not eligible for new assignments, and become eligible again when they reappear in `Ready` or `Retry`. A failed fetch leaves presence unchanged and the pass does not assign work. A database error rolls back the entire sync.

Existing databases must already have `tickets.present_on_board`; the scheduler does not migrate them. SQLite stores the flag as `0` or `1`; `TicketStore` exposes it as the boolean `presentOnBoard`.

`AgentManager.assignTicket()` chooses the first idle agent in local ID order with no incomplete assignment. `SchedulerDatabase.createAssignment()` records ownership in a SQLite transaction, without changing the ticket or agent status. No agent available means no assignment. Missing or invalid connection settings prevent startup.

An assigned ticket can remain `Ready` or `Retry` until the future resource manager moves its card. The scheduler skips any ticket with an incomplete assignment and can select another ticket on a later pass. The resource manager will move the card to `In progress` after confirming the agent has started; the next board fetch copies that status into the local ticket.

Before each scheduling pass, the scheduler checks incomplete assignments still marked `assigned`. Once one reaches `SCHEDULER_ASSIGNMENT_WARNING_MS`, it logs the assignment, ticket, and agent IDs and how long it has waited. Warnings repeat no more often than that interval while it remains assigned. The check also runs when the board is unavailable. Invalid `assigned_at` timestamps produce a warning instead of silently escaping monitoring. Warning timing is checked on the polling loop, so a warning may arrive later than the configured threshold. Throttling is in memory and resets on restart. Warnings do not update records, release agents, or prove that an agent failed.

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

Each result contains `vikunjaTaskId`, `title`, `status`, and `priority`. Column titles become statuses exactly as written: `Ready`, `In progress`, `Retry`, and `Done`. All columns are fetched; `SchedulerDatabase.getReadyTickets()` separately selects present tickets in `Ready` or `Retry` that have no incomplete assignment.

Pagination uses each column's `count`, not the outer pagination header. Empty columns may contain `tasks: null`. Duplicate task IDs are returned once. Failed requests, invalid data, and stalled pagination throw rather than returning partial results. Multiple requests are not an atomic board snapshot; cards can move while pages are fetched.

Optional `perPage` defaults to 50; `timeoutMs` defaults to 30,000 milliseconds per request. Tests inject a fake `fetch` as the constructor's second argument. `getTickets()` does not write to either system.

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

The database owns assignment and agent state; Vikunja owns ticket column status. A separate app will watch the agent and assignment records and reconcile the real agent resources with the desired state. The scheduler records assignments; it does not start or monitor agents, update agent status, or move cards. The watcher is intended to report real agent status and observed progress back to the database, using `assignments.agent_id` to find the real agent by `agents.id`. A saved assignment alone is not proof that an agent is running. An incomplete assignment reserves the agent even while its status remains `idle`.

The scheduler records new assignments as `assigned`. A possible future flow is for the watcher to report `running` after confirming startup and `completed` or `failed` after work ends. The watcher and the rest of the lifecycle are not implemented here. Existing assignment statuses are not migrated.

- `idle`: eligible, provided the agent has no assignment whose `completedAt` is null.
- `busy`: ineligible for new assignments. The scheduler does not set this status; the future watcher is responsible for reporting agent status. Other status strings are excluded.
- Assignment `assigned`: ownership recorded, not proof that an AI worker is executing. Older records may still say `running`; the scheduler does not verify that they are running.
- Completion: still manual through the stores until the watcher exists. Set the assignment's completion timestamp and report the agent as idle only when its work is actually finished. Moving the board card to Done alone does not release the reservation.

`SchedulerDatabase` now receives the shared SQLite connection and constructs its own stores. `AgentManager` receives the scheduler database, AgentStore, and AssignmentStore on that same connection. Transactions recheck persisted ticket readiness and agent availability and reject duplicate active ownership. Raw stores remain low-level CRUD and can bypass these scheduling rules.

The watcher must coordinate card movement and completion: once an assignment has a completion timestamp, a card still in `Ready` or `Retry` can be assigned again. Handling move failures, worker dispatch, and completion monitoring remains future work.

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
