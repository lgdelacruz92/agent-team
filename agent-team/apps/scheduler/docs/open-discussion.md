# Ticket Scheduler and Resource Manager discussion

Estimated reading time: 4 minutes (150 WPM)

This file tracks the current state of the earlier retry-limit discussion. Discuss remaining details one at a time. See [missing features](missing-features.md) for implementation work and the [Resource Manager data design](../../agent-resource-manager/docs/data.md) for the current shared-data decisions. The older [retry-limit handoff](retry-limit-handoff.md) provides background but predates some decisions below.

## Decided directions

- The Resource Manager moves failed work to `Retry`. Before assigning an eligible `Retry` ticket, the Ticket Scheduler checks the attempt count and moves exhausted tickets to `Flagged tickets` for human intervention.
- The first attempt counts as 1. The execution table is the source of truth: an execution counts when `work_requested_at` is recorded after sending the work request. An unrecorded request does not count, even if it was sent before a crash; duplicate work is an accepted risk.
- Keep the numeric agent ID and add the OpenCode server URL to the agents table. The Resource Manager marks unreachable agents unavailable for human review; an eligible retry should use another available agent.
- Both apps coordinate using a shared database lock. The Ticket Scheduler holds it across board fetch, sync, and scheduling; the Resource Manager holds it across the final card move and assignment completion. The lock uses a uniquely named row and owner token; only the matching owner releases it. If held, retry coordinated work on the next tick. Potentially stale locks are left for human review.
- If the final card move fails or is uncertain, keep the assignment reserved, release the lock, and retry later. If the move succeeds but completing the assignment fails, leave the card in its final column and retry completion under the lock; inspect the assignment first if the database result is uncertain.
- Assume humans do not manually move cards. The user expects the Ticket Scheduler to flag data inconsistencies appropriately, but broad coverage has not been verified.

## Values and details to work out

- **Attempt limit:** the value and how it is configured. The execution timeout is also unset.
- **Human intervention:** how a flagged ticket is allowed to run again, including whether or how its attempt count changes.
- **Failures:** how the Ticket Scheduler reports and retries when the count is unavailable or the move to `Flagged tickets` fails. It must not assign another attempt when the limit may have been reached.
- **Shared implementation:** SQLite migration, lock naming and ownership details, transaction boundaries, session recovery, and coordinating execution outcomes with assignment release. Confirm both apps use the same database and lock protocol.
- **Agent review:** the unavailable/review status representation and how a human restores availability.

**Deferred:** stale-lock warning threshold and human recovery steps; logging implementation, retention, and monitoring details. Do not choose these silently.

## Open: not yet discussed

No undiscussed topics are currently listed. An agreed direction may still have implementation details to work out.
