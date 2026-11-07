# Missing features: Ticket Scheduler and Resource Manager

Estimated reading time: 5 minutes (150 WPM)

This is a checklist of work needed for the two apps to work together, not authorization to implement it or run live agents. See [discussion](open-discussion.md), the [Resource Manager data design](../../agent-resource-manager/docs/data.md), and the [sequence diagram](../../agent-resource-manager/docs/sequence-diagram.md) for decisions and remaining details.

## Current baseline

- The Ticket Scheduler fetches and syncs the Vikunja board, then reserves at most one eligible ticket and agent per pass. An assignment with `completed_at` empty reserves both; it does not start work.
- The Resource Manager has an idle process loop and draft interfaces, but no Resource Manager class or real integrations. Its loop does not load a manager or contact external systems.
- The current shared SQLite schema has tickets, agents, and assignments. It has no agent URL, `executions` table, or `locks` table. The scheduler has no attempt-limit check or card-move operation.

## Shared data and coordination

- [ ] Add and migrate the agent's OpenCode URL while preserving numeric `agents.id` and existing data. Decide provisioning and handling of older rows without a URL.
- [ ] Add the agreed execution fields and statuses from the data design, linked to assignments. Store session IDs, outcomes, and `work_requested_at`; count only records with a recorded work request. An unrecorded request after a crash does not count, even if work was sent.
- [ ] Add the agreed lock fields and shared lock protocol: atomic acquisition by unique name and owner token, owner-checked release, and retry on a later tick if held. Do not automatically remove potentially stale locks. The warning threshold and human recovery steps are deferred.
- [ ] Make both apps use the same SQLite database and coordination protocol. SQLite WAL is a same-host proof-of-concept choice; a future database migration is separate work. Coordinate schema migrations and preserve existing reservations.

## Ticket Scheduler

- [ ] Hold the shared lock across board fetch, ticket sync, and assignment selection/creation. Preserve the existing rules: only present `Ready` or `Retry` tickets, no incomplete assignment, and an `idle` agent without an incomplete assignment.
- [ ] Before assigning an eligible `Retry` ticket, count its recorded attempts through executions and assignments. The initial attempt counts as 1. The limit and its configuration are not yet decided.
- [ ] At the limit, move the card to `Flagged tickets` rather than creating an assignment. Add the required Vikunja move operation and handle unavailable counts, missing or ambiguous columns, and failed or uncertain moves without creating an extra attempt.
- [ ] Continue to exclude unavailable agents; use another available agent for an eligible retry. The exact human-review status and recovery procedure remain to be worked out.

## Resource Manager

- [ ] Implement the manager and non-overlapping reconciliation loop using the integration interfaces. Poll each agent, read incomplete assignments, and report observed state. Do not treat an assignment as proof that work started.
- [ ] Implement shared-database, Vikunja, and OpenCode integrations. Fetch the full task description; on failure keep the reservation, retry, and alert a human if the failure persists. A fetch failure is not an agent attempt; alert timing and delivery remain undecided.
- [ ] Persist execution and session state and implement the agreed startup and restart behavior in the data design. This includes saving the session ID before sending work and recording `work_requested_at` after sending. The user accepts possible duplicate work when a sent request was not recorded.
- [ ] Determine and record outcomes: idle and ready means success without checking task results; too slow or unreachable means failure. Attempt to stop a failed session, but do not require confirmation before allowing a retry. Mark unreachable agents unavailable for human review. The timeout is not yet set.
- [ ] Move cards to `In progress` after confirmed startup, `Done` on success, and `Retry` on failure. Use the shared lock for final movement and assignment completion; preserve reservations and retry safely when moves or database updates fail or are uncertain.
- [ ] Add execution and lock operations to the draft integration contracts as the shared protocol is implemented. The current database interface does not yet expose execution records or lock coordination.

## Verification before real dispatch

- [ ] Test attempt counting, first-attempt behavior, below/at-limit retries, flagged-ticket moves, unavailable counts, and move failures using controlled dependencies.
- [ ] Test lock contention, owner-checked release, overlapping scheduler fetches, completion failures, restart recovery, and agent unavailability. Include the accepted unrecorded-request and duplicate-work cases.
- [ ] Test the two apps against the same controlled database and fake Vikunja/OpenCode services before requesting authorization for live dispatch. Do not assume the existing checks detect every data inconsistency.

The user favors understandable code and human monitoring. The planned separate session-cleanup cronjob and logging implementation are outside this checklist's immediate integration scope; neither is implemented here.
