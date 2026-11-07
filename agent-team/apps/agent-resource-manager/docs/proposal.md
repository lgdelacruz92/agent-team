# Agent resource manager: initial proposal

Estimated reading time: 6 minutes (150 WPM)

**Status: proposal, not an approved contract or an implementation.** Start with the [flowchart](flowchart.md). Existing scheduler responsibilities and open questions are in the [scheduler handoff](../../scheduler/docs/agent-resource-manager.md).

## Goal

Turn scheduler assignments into real agent work and keep the database and Vikunja informed of what actually happened. The scheduler posts the job; the resource manager checks that the worker really picked it up.

**Proposed success:** one assigned ticket can be started, observed, and safely completed, including ordinary restarts and failed card moves, without silently starting duplicate work or freeing a still-working agent.

## Proposed shape

Keep this a separate, small TypeScript app, consistent with the scheduler. Suggest these responsibilities, not a final folder structure:

- **Reconciliation loop:** periodically read incomplete assignments and decide what needs attention. One pass should finish before the next starts.
- **Database adapter:** read assignments, tickets, and agents from the same SQLite database; update only fields the manager owns. Use short transactions for related database writes.
- **Agent adapter:** start work and check the actual agent's state. The real interface, identification, payload, and completion evidence still need investigation.
- **Vikunja adapter:** move and check cards. The scheduler continues to fetch board state into the ticket table; the manager does not own that sync.
- **Logging:** report assignment and agent IDs, current action, failures, and situations needing a human. A health endpoint is optional, not a substitute for monitoring work.

These are boundaries, not a requirement to build all of them at once. How code and SQLite access are shared with the scheduler remains open.

## Proposed lifecycle

1. **Find:** read an incomplete assignment. Its `agent_id` identifies the real agent; its `ticket_id` points to a local ticket containing the Vikunja task ID.
2. **Check before starting:** determine whether this assignment is already running or finished. Only start when it is safe to do so; unknown results need reconciliation or human attention, not a blind retry.
3. **Confirm:** once the agent is actually running, report the observed agent state and assignment progress, and move the card to `In progress`. Exact ordering and recovery across the database and Vikunja are still decisions.
4. **Observe:** check for completion or failure. A failed card move is retried or surfaced; it does not by itself mean the agent stopped.
5. **Finish safely:** coordinate the final card state, local ticket state, assignment completion, and agent availability. Set `completed_at` and mark the agent `idle` only under a protocol that protects against duplicate scheduling and reflects actual availability.

The current schema permits status strings but does not enforce a state machine. `running`, `completed`, and `failed` are possible labels, not an approved contract.

## Safety boundaries to design first

- **Uncertain starts:** a process may crash after the agent receives a start request but before the manager records success. Automatic retry is safe only if the agent supports a stable assignment-based idempotency key or reliable lookup of existing work. Otherwise leave the reservation in place and ask a human to reconcile it.
- **One manager:** initially propose a single active instance. A deployment convention alone does not prevent two instances; decide how exclusivity is enforced before relying on it. Agent-side idempotency or reliable lookup is still needed for crashes.
- **Completion race:** completing an assignment while the scheduler sees `Ready` or `Retry` can create duplicate work. Even a successful card move and subsequent local sync are not enough on their own: an earlier board fetch can finish later and overwrite the local status. Design an enforceable coordination protocol, potentially requiring a scheduler change or controlled scheduler pause, before automatic completion.
- **Unknown or older records:** an old `running` status is not proof of a real running agent. Investigate actual state before taking action; keep the reservation when state cannot be established.

## Build in slices

| ID | Slice | Done when | Depends on |
| --- | --- | --- | --- |
| A1 | Understand the real agent integration | We know how to find an agent, send work, observe it, and identify an existing execution—or know which capabilities are missing. | Nothing |
| D1 | Agree on lifecycle and recovery | Status ownership, startup, failures, completion, and human intervention have an agreed contract. | A1 |
| D2 | Agree on database and board coordination | Shared DB access, single-manager enforcement, and a completion protocol cover overlapping scheduler fetches. | A1, D1 |
| A2 | Build one observable reconciliation pass | Tests show it reads assignments and chooses actions without starting real agents; uncertain state stays reserved. | D1, D2 |
| A3 | Add agent and Vikunja integrations | Tests cover confirmed startup, repeated observations, restart recovery, and failed moves using controlled dependencies. | A1, A2 |
| A4 | Add safe completion and operation | Tests cover completion races, failure handling, agent availability, and the chosen coordination protocol; run a controlled end-to-end test only when authorized. | D2, A3 |

The next useful step is **A1**: inspect the actual agent runtime and how a real agent ID maps to it. Then review the lifecycle together before building the app.

## Decisions still open

1. What is a real agent in this setup, and what API can start and inspect its work?
2. What ticket information and instructions must the agent receive, and where are they stored?
3. What proves startup and completion, and how can we identify work after a restart?
4. Which statuses, failure outcomes, and card moves do we want?
5. How will we enforce one active manager and prevent scheduler completion races?
6. How should missing cards, manually moved cards, and older assignments be handled?
