# Ticket Scheduler: attempt limit and flagged tickets handoff

Estimated reading time: 6 minutes (150 WPM)

**Historical handoff:** Some questions below have since been decided. Use [open-discussion.md](open-discussion.md), [missing-features.md](missing-features.md), and the [Resource Manager data design](../../agent-resource-manager/docs/data.md) for the current direction and remaining work.

## Purpose

Give a future agent the requested change to the separate Ticket Scheduler app in `apps/scheduler`. This document is a handoff, not an implementation. The Resource Manager in `apps/agent-resource-manager` is also not implemented.

## Agreed responsibility split

- The Resource Manager records work outcomes and moves failed work to Vikunja `Retry`.
- Before assigning an eligible `Retry` ticket again, the Ticket Scheduler checks its attempt count. The first attempt counts as **1** toward the limit.
- If the limit is reached, the Ticket Scheduler must not create another assignment. It moves the card from `Retry` to the new Vikunja `Flagged tickets` column for human intervention.
- If the ticket is below the limit, the Ticket Scheduler may assign it subject to its existing eligibility and reservation checks.
- If the previous agent is unreachable, the Resource Manager flags it for human review and marks it unavailable; the Ticket Scheduler should use another available agent for an eligible retry.
- The user suggested counting attempts from a future shared `executions` table. That table and its schema do not exist yet; how attempts are identified and counted needs a shared contract.

For example, if the eventual limit is 3, the first run is attempt 1. After three qualifying attempts reach the limit, the Ticket Scheduler flags the ticket instead of assigning attempt 4. The actual limit is not yet decided.

## Current behavior

- Each scheduler pass fetches all board columns, synchronizes tickets to SQLite, and selects at most one present `Ready` or `Retry` ticket without an incomplete assignment.
- An assignment with `completed_at` set to null reserves both its ticket and agent. Assignment status text alone does not release it.
- The Ticket Scheduler currently has no execution table, attempt counter, maximum, or card-move operation. It does not determine whether agent work succeeded or failed.
- It already ignores `Flagged tickets` for assignment because only `Ready` and `Retry` are eligible. The requested change is to detect the limit and move the card, not to schedule flagged tickets.

## Work for the next agent

1. Review the scheduler source and the [Resource Manager session context](../../agent-resource-manager/docs/session-context.md), [sequence diagram](../../agent-resource-manager/docs/sequence-diagram.md), and [scheduler handoff](agent-resource-manager.md).
2. Agree on the shared execution record and counting contract before relying on it: ticket association, qualifying attempts and outcomes, the limit value and configuration, and treatment of uncertain starts. Do not silently invent a schema or default limit.
3. Design and implement the limit check and Vikunja move to `Flagged tickets`, including behavior if the attempt count cannot be determined, the column is missing or ambiguous, or the move fails. Do not let a failed or uncertain move result in another assignment at the limit.
4. Preserve incomplete-assignment reservations. Coordinate with the Resource Manager's completion protocol and overlapping board fetches; moving a card and updating SQLite are not one atomic operation. Do not assume this ownership split by itself resolves stale-fetch or concurrent-assignment races.
5. Add tests for first-attempt counting, below and at the limit, no extra assignment at the limit, flagged tickets staying ineligible, move failures, unavailable attempt data, existing reservations, and relevant concurrency or stale-fetch cases. Use controlled dependencies; do not start real agents or change live infrastructure without authorization.

The user prefers a shared database lock for this proof of concept, with potentially stale locks flagged for a human rather than automatically cleared. The lock protocol, warning threshold, and recovery procedure still need agreement. The current database is SQLite; migrating to a different database is separate future work.

## Open questions

- What is the attempt limit, and where is it configured?
- What exactly constitutes a qualifying attempt, especially after an uncertain start or a human intervention? Does a human reset or otherwise change the count?
- What is the shared `executions` schema, and how is it migrated and kept consistent with assignment outcomes?
- The user accepts a retry after the Resource Manager decides an attempt failed even if stopping the old session cannot be confirmed. How should this interact with assignment release and the attempt limit? A stop request does not prove the old session stopped.
- How should failed card moves be retried or surfaced, and what happens if a card is moved manually during the check?
- What protocol prevents duplicate scheduling when a board fetch overlaps a card move or assignment completion?

The user wants a practical system with human monitoring, not an unnecessarily complex platform. Resolve the open decisions with the user rather than treating this handoff as a complete lifecycle contract.
