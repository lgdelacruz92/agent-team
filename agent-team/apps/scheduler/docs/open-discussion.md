# Ticket Scheduler and Resource Manager discussion

Estimated reading time: 5 minutes (150 WPM)

This file tracks the current state of the earlier retry-limit discussion. Discuss remaining details one at a time. See [missing features](missing-features.md) for implementation work and the [Resource Manager data design](../../agent-resource-manager/docs/data.md) for the current shared-data decisions. The older [retry-limit handoff](retry-limit-handoff.md) provides background but predates some decisions below.

## Decided directions

- The Resource Manager moves failed work to `Retry`. Before assigning an eligible `Retry` ticket, the Ticket Scheduler checks the attempt count and moves exhausted tickets to `Flagged tickets` for human intervention.
- The first attempt counts as 1. The execution table is the source of truth: an execution counts when `work_requested_at` is recorded after sending the work request. An unrecorded request does not count, even if it was sent before a crash; duplicate work is an accepted risk.
- Allow 3 total attempts by default, including the first; make the limit configurable. The scheduler reads `SCHEDULER_MAX_ATTEMPTS`, but does not enforce it yet.
- Keep the numeric agent ID and add the OpenCode server URL to the agents table. The Resource Manager marks unreachable agents unavailable for human review; an eligible retry should use another available agent.
- Both apps coordinate using a shared database lock. The Ticket Scheduler holds it across board fetch, sync, and scheduling; the Resource Manager holds it across the final card move and assignment completion. The lock uses a uniquely named row and owner token; only the matching owner releases it. If held, retry coordinated work on the next tick. Potentially stale locks are left for human review.
- Both apps use the same SQLite database and shared tables. Someone must set up the database and all tables; the Ticket Scheduler does not create or migrate them. The approved models are copied into [shared-data.md](shared-data.md) for scheduler session handoffs. See [setup](setup.md).
- If the final card move fails or is uncertain, keep the assignment reserved, release the lock, and retry later. If the move succeeds but completing the assignment fails, leave the card in its final column and retry completion under the lock; inspect the assignment first if the database result is uncertain.
- Assume humans do not manually move cards. The user expects the Ticket Scheduler to flag data inconsistencies appropriately, but broad coverage has not been verified.
- What happens after a ticket is flagged, including how to allow it to run again, is up to the human and outside this app's concern. No automated reset or human-intervention workflow is planned here.
- The Ticket Scheduler relies on the state it sees in the `agents` table; it selects only `idle` agents without an incomplete assignment. The Resource Manager is responsible for keeping that state as close to the real resources as possible. The user tolerates occasional agent-data inconsistencies; the scheduler does not need to decide the manager's review status.
- If reading an eligible `Retry` ticket's attempt count fails, log the error, stop the scheduling pass without assigning work, and retry on the next pass. This behavior is not implemented yet.
- If moving an exhausted ticket to `Flagged tickets` fails or its result is uncertain, log the error and stop the pass without assigning work. On the next pass fetch the board again: leave the ticket alone if it is already flagged, or retry the move if it remains in `Retry`. This behavior is not implemented yet.

## Values and details to work out

- **Execution timeout:** the value remains unset.
- **Shared implementation:** lock naming and ownership details, transaction boundaries, session recovery, and coordinating execution outcomes with assignment release. Both apps must use the same database and lock protocol.

**Deferred:** stale-lock warning threshold and human recovery steps; logging implementation, retention, and monitoring details. Do not choose these silently.

## Open: not yet discussed

No undiscussed topics are currently listed. An agreed direction may still have implementation details to work out.
