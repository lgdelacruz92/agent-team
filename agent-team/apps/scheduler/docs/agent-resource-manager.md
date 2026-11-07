# Agent resource manager handoff

Estimated reading time: 7 minutes (150 WPM)

## Purpose

Design a separate application that watches the scheduler database and reconciles real agent resources with the system state recorded there. The database is intended to be the shared source of truth. The scheduler decides which ticket to assign; the resource manager makes the real agents reflect that assignment and reports what actually happens.

This document describes the existing scheduler and the intended integration. **The resource manager is not implemented**, and the proposed lifecycle below is not a finished contract.

## Agreed boundaries

- The `agents` table is prepopulated outside the scheduler with valid real agent IDs and states. `agents.id` is the real agent ID the resource manager will use, not an ID that needs a separate external-ID field.
- The scheduler assumes those IDs and states are valid. It does not provision agents, discover them, start OpenCode sessions, or monitor their execution.
- The scheduler creates assignments. It does not update `agents.status` when it assigns work. The future resource manager is responsible for reporting real agent status.
- `assignments.agent_id` references `agents.id`. `assignments.ticket_id` references the scheduler's local ticket ID, not the Vikunja task ID.
- The database stores system state, but a recorded request is not proof that a real-world action occurred. The resource manager needs to confirm what actually happened before reporting it.

## Current scheduler behavior

Each pass fetches Vikunja cards, atomically synchronizes their data and board presence locally, and attempts at most one present `Ready` or `Retry` ticket in local ID order. Missing cards remain stored but are ineligible for new assignments; their existing assignments stay untouched. A failed fetch does not change presence or assign work. The agent manager chooses the first agent whose status is exactly `idle` and which has no assignment with `completed_at` set to null.

When a new assignment succeeds, one SQLite transaction:

1. Rechecks the ticket and agent, including the absence of incomplete assignments for either.
2. Inserts an assignment with status `assigned`, the current UTC `assigned_at`, and `completed_at` set to null.
3. Sets the local ticket status to `In progress`. The agent's status stays unchanged.

An incomplete assignment reserves the agent even if `agents.status` still says `idle`. This prevents another ticket being assigned while the resource manager has not yet reported a status change. The reservation is based on `completed_at`, not the assignment status string.

For example, immediately after a successful assignment, the rows could look like:

| Table | Relevant values |
| --- | --- |
| `tickets` | `id: 1`, `vikunja_task_id: …`, `title: …`, `status: In progress`, `priority: 0`, `present_on_board: 1` |
| `assignments` | `id: 1`, `ticket_id: 1`, `agent_id: 1`, `status: assigned`, `assigned_at: <current time>`, `completed_at: null` |
| `agents` | `id: 1`, `name: …`, `status: idle` |

These IDs are examples. Agent status is `idle`, not `ready`; a new assignment has no completion time.

## Vikunja timing and failures

After the local assignment transaction succeeds, the scheduler asks Vikunja to move the card to the `In progress` column. The database commit and Vikunja request are separate; the move does **not** wait for the resource manager or an agent to start.

- If no agent is available, no new assignment is created and the card is not moved.
- If new assignment creation fails, the transaction rolls back the new assignment and local ticket update. The Vikunja card is not moved by that attempt.
- If the assignment succeeds but the Vikunja move fails, the assignment remains saved. A later pass can reuse the incomplete assignment and retry the move rather than creating a duplicate.
- A later board refresh can copy `Ready` or `Retry` back into the local ticket while the assignment remains incomplete. Do not treat ticket status alone as proof that an assignment is absent or execution has stopped.

The resource manager could observe `assigned` before the Vikunja move succeeds, because the assignment is committed first. Decide whether it may start work immediately or whether an additional coordination rule is needed. Also consider what happens if work finishes before a failed card move is retried: once the assignment is completed, the scheduler's incomplete-assignment reuse no longer protects that retry. This interaction is not resolved by the current code.

## Resource manager direction

The intended flow is:

1. Observe an `assigned` record and identify the real agent using its `agent_id`.
2. Reconcile the requested work with that agent. Update `agents.status` to reflect the agent's actual state, not merely the scheduler's request.
3. After confirming startup, report assignment `running`. After work finishes, report the outcome and completion time, and report the agent `idle` only when it is actually available again.

Steps 2–3 are design direction, not implemented behavior or a finalized state machine. `completed` and `failed` are possible outcomes, not enforced statuses today. Moving a Vikunja card to `Done` does not complete an assignment or release an agent. Until the watcher exists, completion and agent status updates are manual.

## Design questions before implementation

- **Lifecycle and ownership:** Which assignment statuses and transitions are allowed? Who writes each field, and how are desired state and observed state distinguished?
- **Starting work:** What information must be sent to the real agent, and where does it come from? The current ticket table contains an ID, Vikunja task ID, title, status, priority, and board-presence flag—not a complete execution payload.
- **Idempotency and recovery:** How will repeated observations, process restarts, multiple watcher instances, and uncertain start results avoid starting the same work twice?
- **Failures and release:** How are startup failure, execution failure, cancellation, retry, and unavailable agents represented? When can `completed_at` be set and an agent safely become `idle`?
- **Vikunja coordination:** Should work wait for the board move? How are failed moves and fast completion reconciled without creating duplicate work?
- **Shared database access:** How will the other app access the same database and coordinate writes? The scheduler currently uses SQLite; no domain HTTP routes or watcher mechanism are provided.
- **Agent ID provisioning:** How will the external provisioning process insert and maintain valid real IDs? The existing `AgentStore.create` lets SQLite generate an ID and does not validate it against a real agent.
- **Older data:** Existing assignments created before `assigned` was introduced may say `running` without evidence that work started. No migration has been performed; decide how to handle them safely.

## Implementation references

- [`../src/components/scheduler.ts`](../src/components/scheduler.ts): scheduling pass and Vikunja move order.
- [`../src/components/agent-manager.ts`](../src/components/agent-manager.ts): selection, existing assignment reuse, and initial assignment status.
- [`../src/components/scheduler-database.ts`](../src/components/scheduler-database.ts): transactional checks and writes.
- [`../src/db/database.ts`](../src/db/database.ts) and [`../src/db/stores-doc.md`](../src/db/stores-doc.md): current SQLite schema.
- [`../README.md`](../README.md): setup and current operational details.
