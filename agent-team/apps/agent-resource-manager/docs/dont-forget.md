# Resource Manager: don't forget

Estimated reading time: 3 minutes (150 WPM)

High-priority work to return to:

- [ ] Continue the [data and coordination design](data.md), including the remaining session-recovery and shared-lock implementation details.
- [ ] Continue Resource Manager `runOnce()` and its integration contracts. The loop now checks agent state, but does not reconcile assignments or dispatch work.
- [ ] Implement the Resource Manager responsibilities and shared-integration work below. The Ticket Scheduler's [shared data reference](../../scheduler/docs/shared-data.md) records the integration contract.

## Resource Manager implementation reminders

- [ ] Extend the manager's non-overlapping loop beyond its implemented agent checks: read incomplete assignments and report execution and assignment state. Do not treat an assignment as proof that work started.
- [ ] Implement shared-database, Vikunja, and OpenCode integrations. Fetch the full task description; on failure keep the reservation, retry, and alert a human if the failure persists. A fetch failure is not an agent attempt; alert timing and delivery remain undecided.
- [ ] Persist execution and session state and implement the agreed startup and restart behavior in the [data design](data.md). Save the session ID before sending work and record `work_requested_at` after sending. The user accepts possible duplicate work when a sent request was not recorded.
- [ ] Determine and record outcomes: idle and ready means success without checking task results; too slow or unreachable means failure. Attempt to stop a failed session, but do not require confirmation before allowing a retry. Mark unreachable agents unavailable for human review. The timeout is not yet set.
- [ ] Move cards to `In progress` after confirmed startup, `Done` on success, and `Retry` on failure. Use the shared `ticket-scheduling` lock for final movement and assignment completion; preserve reservations and retry safely when moves or database updates fail or are uncertain.
- [ ] Add execution and lock operations to the draft integration contracts. Use the same prepared SQLite database and lock protocol as the Ticket Scheduler. The current database interface does not yet expose execution records or lock coordination.
- [ ] Before real dispatch, test completion failures, restart recovery, agent unavailability, unrecorded requests, and duplicate-work cases with controlled dependencies; test both apps together against the same controlled database and fake services.

These are reminders, not authorization to implement or start live agents. Follow the agreed decisions and deferred details in the linked documents.
