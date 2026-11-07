# Agent resource manager handoff

Estimated reading time: 11 minutes (150 WPM)

## Purpose

Design a separate application in `apps/agent-resource-manager/` that watches the scheduler database and reconciles real agent resources with the system state recorded there. Think of the database as a shared job board: the scheduler posts assignments, and the resource manager makes the real agents reflect them and reports what actually happens.

This document describes the existing scheduler and the intended integration. **The resource manager is not implemented**, and the proposed lifecycle below is not a finished contract. Check the linked scheduler source before implementation; distinguish agreed responsibilities from the open design questions below.

The user values understandable code over development speed and wants a practical system for common cases, with a human monitoring it. Avoid inventing a complex distributed platform to cover every rare edge case; still make ordinary retries and recovery safe enough that a monitor can intervene.

## Agreed boundaries

- The `agents` table is prepopulated outside the scheduler with valid real agent IDs and states. `agents.id` is the real agent ID the resource manager will use, not an ID that needs a separate external-ID field. The current SQLite schema uses integer IDs within JavaScript's safe integer range; it does not store an agent endpoint.
- The scheduler assumes those IDs and states are valid. It does not provision agents, discover them, start OpenCode sessions, or monitor their execution.
- The scheduler creates assignments without updating ticket or agent status. The future resource manager is responsible for reporting real agent status and moving the Vikunja card to `In progress` after confirming startup.
- Vikunja is the authority for ticket column status; the database owns assignments and agent state. Manual card moves do not automatically complete or cancel assignments or stop agents. Any additional response to those moves remains a separate decision.
- `assignments.agent_id` references `agents.id`. `assignments.ticket_id` references the scheduler's local ticket ID, not the Vikunja task ID.
- The database stores system state, but a recorded request is not proof that a real-world action occurred. The resource manager needs to confirm what actually happened before reporting it.
- A warning about a long-waiting assignment is a request for human attention, not permission to free the agent automatically. The agent could already be working even if its state has not been reported.

## Current scheduler behavior

Each pass fetches Vikunja cards, atomically synchronizes their data and board presence locally, and attempts at most one present `Ready` or `Retry` ticket without an incomplete assignment, in local ID order. Missing cards remain stored but are ineligible for new assignments; their existing assignments stay untouched. A failed fetch does not change presence or assign work. The agent manager chooses the first agent whose status is exactly `idle` and which has no assignment with `completed_at` set to null.

When a new assignment succeeds, one SQLite transaction:

1. Rechecks the ticket and agent, including the absence of incomplete assignments for either.
2. Inserts an assignment with status `assigned`, the current UTC `assigned_at`, and `completed_at` set to null.
3. Leaves the ticket and agent statuses unchanged.

An incomplete assignment reserves both the ticket and the agent even if the ticket still says `Ready` and the agent still says `idle`. The scheduler can move on to another ticket while the resource manager starts work. The reservation is based on `completed_at`, not the assignment status string.

The scheduler logs a warning when an incomplete assignment stays `assigned` beyond the configured threshold, 10 minutes by default. It repeats at the configured interval, without persisting a warning flag. The warning does not release the agent or change any database state. It does not monitor how long an assignment stays `running`. The watcher should report actual progress; a long wait alone is not proof that an agent failed.

For example, immediately after a successful assignment, the rows could look like:

| Table | Relevant values |
| --- | --- |
| `tickets` | `id: 1`, `vikunja_task_id: …`, `title: …`, `status: Ready`, `priority: 0`, `present_on_board: 1` |
| `assignments` | `id: 1`, `ticket_id: 1`, `agent_id: 1`, `status: assigned`, `assigned_at: <current time>`, `completed_at: null` |
| `agents` | `id: 1`, `name: …`, `status: idle` |

These IDs are examples. Agent status is `idle`, not `ready`; a new assignment has no completion time.

## Vikunja timing and failures

The scheduler does not move Vikunja cards. The future resource manager is responsible for moving a card to `In progress` after confirming the agent has started. A later successful scheduler fetch copies the new column status into the local ticket.

- If no agent is available, no new assignment is created and the card is not moved.
- If new assignment creation fails, the transaction rolls back the assignment. The scheduler never moves the card.
- While an assignment remains incomplete, later passes skip that ticket even if the card still says `Ready` or `Retry`. Do not treat ticket status alone as proof that an assignment is absent or execution has stopped.

The resource manager must handle failed moves and coordinate completion with Vikunja. If `completed_at` becomes non-null while the card remains `Ready` or `Retry`, the scheduler can assign that ticket again. This interaction is not resolved by the current code.

Vikunja changes and SQLite updates cannot be committed as one transaction. A board fetch can also overlap a card move. Design and test recovery around these boundaries rather than assuming that changing the card and the database happens simultaneously.

For reference, the previous scheduler implementation discovered exactly one `In progress` bucket from the board, then posted to `/api/v1/projects/{projectId}/views/{viewId}/buckets/{bucketId}/tasks` with `task_id`, `bucket_id`, `project_view_id`, and `project_id`. Its implementation and tests remain in Git history before this change; the resource manager's integration still needs its own design and tests.

## Resource manager direction

The intended flow is:

1. Observe an `assigned` record and identify the real agent using its `agent_id`.
2. Reconcile the requested work with that agent. Update `agents.status` to reflect the agent's actual state, not merely the scheduler's request.
3. After confirming startup, move the card to `In progress` and report assignment `running`. After work finishes, report the outcome and completion time, and report the agent `idle` only when it is actually available again.

Steps 2–3 are design direction, not implemented behavior or a finalized state machine. `completed` and `failed` are possible outcomes, not enforced statuses today. Moving a Vikunja card to `Done` does not complete an assignment or release an agent. Until the watcher exists, completion and agent status updates are manual.

## Manual testing before the watcher exists

A human can stand in for the resource manager:

1. Put a ticket in Vikunja `Ready`; ensure a valid agent row is `idle`. Wait for an `assigned` record.
2. Simulate startup by marking the agent `busy`, marking the assignment `running`, and moving the card to `In progress`. The scheduler copies the card status on a later poll.
3. Simulate completion by moving the card to `Done`, confirming the scheduler has copied that status, then setting the assignment status and `completed_at` and returning the agent to `idle`. For controlled testing, stop the scheduler during manual completion if needed to avoid concurrent-pass races.

The scheduler has no domain HTTP endpoints for these updates. This procedure does not start a real agent or establish the future watcher's completion protocol.

## Design questions before implementation

- **Lifecycle and ownership:** Which assignment statuses and transitions are allowed? Who writes each field, and how are desired state and observed state distinguished?
- **Starting work:** What information must be sent to the real agent, and where does it come from? The current ticket table contains an ID, Vikunja task ID, title, status, priority, and board-presence flag—not a complete execution payload.
- **Idempotency and recovery:** How will repeated observations, process restarts, multiple watcher instances, and uncertain start results avoid starting the same work twice?
- **Failures and release:** How are startup failure, execution failure, cancellation, retry, and unavailable agents represented? When can `completed_at` be set and an agent safely become `idle`?
- **Vikunja coordination:** How are failed moves and fast completion reconciled without creating duplicate work? The watcher owns the move after confirming startup.
- **Shared database access:** How will the other app access the same database and coordinate writes? The scheduler currently uses SQLite; no domain HTTP routes or watcher mechanism are provided.
- **Agent ID provisioning:** How will the external provisioning process insert and maintain valid real IDs? The existing `AgentStore.create` lets SQLite generate an ID and does not validate it against a real agent.
- **Older data:** Existing assignments created before `assigned` was introduced may say `running` without evidence that work started. No migration has been performed; decide how to handle them safely.

## Observability and access

- The scheduler uses SQLite at `SCHEDULER_DB_PATH`; the default is `data/scheduler.sqlite` relative to the scheduler process's working directory. The future app must deliberately connect to the same database, not assume its own working directory resolves the same path.
- The current stores are low-level CRUD; direct writes can bypass scheduler checks. Coordinate concurrent database updates and preserve the invariant that incomplete assignments reserve their ticket and agent.
- `GET /health` is process liveness only. `GET /status` reports scheduler pass activity and outcomes, not whether real agents or the watcher are healthy. Both belong to the scheduler; neither is a watcher API.

## Implementation references

- [`../src/components/scheduler.ts`](../src/components/scheduler.ts): scheduling pass; it does not move Vikunja cards.
- [`../src/components/agent-manager.ts`](../src/components/agent-manager.ts): selection, existing assignment reuse, and initial assignment status.
- [`../src/components/scheduler-database.ts`](../src/components/scheduler-database.ts): transactional checks and writes.
- [`../src/db/database.ts`](../src/db/database.ts) and [`../src/db/stores-doc.md`](../src/db/stores-doc.md): current SQLite schema.
- [`../README.md`](../README.md): setup and current operational details.
