# Agent resource manager session context

Estimated reading time: 5 minutes (150 WPM)

## Working agreement

- After each user prompt, update these notes with relevant context, decisions, and project status alongside the requested work. Keep this handoff concise; preserve historical detail in [the archive](session-history-archive.md). Read the archive only when a specific historical question requires it.
- Favor understandable code over speed and practical handling with human monitoring.
- For this session, the user explicitly prefers autonomous, long-running implementation over slow, step-by-step iteration.
- Use **open** only for topics not yet discussed. Distinguish decisions, deferred choices, and implementation details.
- A resume request authorizes context gathering and note updates, not implementation, starting services, infrastructure changes, or commits.

## Current state

- The loop checks registered agents and reconciles incomplete assignments. It fetches tasks, creates and recovers sessions, records executions, reports running work, and uses the scheduler's shared lock to move final cards and release reservations. Controlled tests cover both apps with a shared in-memory database; deployed API compatibility still needs verification.
- Starting the manager can dispatch real work, change agent status, and move cards. Do not start it without a request. Unknown agent responses and missing URLs leave status unchanged; recovered agents are not automatically cleared from `needs_review`. An unchanged `idle` row may still be selected by the scheduler.
- A separate `resource-manager-pass` lock prevents overlapping manager instances. A crash can leave that lock or `ticket-scheduling` behind; both require human review and are not cleared automatically. See [don't forget](dont-forget.md).
- The Ticket Scheduler is a separate app. It reserves tickets and agents through incomplete assignments, implements its side of the shared lock, and enforces a configurable retry limit of three total recorded attempts by default. It does not start or monitor agents.
- Both apps default to `../../shared-db/db.sqlite` and have independent path overrides. A human prepares the database, populates agents, and ensures their entries are valid at startup. The [fresh seed](../../shared-db/seed.sql) includes `agents.url`; an existing database's actual schema has not been verified. The example `agents.sql` inserts a frontend agent and duplicates it if rerun; neither seed nor drop should be run on a user database without authorization.

## Agreed directions

- Fetch the full Vikunja task description before starting. If fetching fails, keep the assignment reserved, retry, and alert a human if failure persists; it is not an agent attempt.
- Create an execution after fetching the task and before creating the session; save the session ID before sending work. Count an attempt only when `work_requested_at` is recorded after sending. A sent but unrecorded request does not count; the user accepts possible duplicate work. See [data design](data.md) for approved restart cases.
- The manager decides outcomes: an agent idle and ready means success without verifying task results; too slow or unreachable means failure. Try to stop a failed session, but retries may proceed without confirmation. Flag unreachable agents for human review and use another available agent.
- Move successful work to `Done` and failed work to `Retry`. The Ticket Scheduler moves exhausted retries to `Flagged tickets`. Assume humans do not manually move cards; broad inconsistency reporting is not established.
- Coordinate final card movement and assignment completion with the same `ticket-scheduling` database lock the Ticket Scheduler holds across board fetch, sync, and scheduling. If unavailable, retain the reservation and retry later. The manager must follow the agreed owner-token protocol and failure handling in [data design](data.md).

## Remaining work and deferred details

- Verify the real OpenCode and Vikunja APIs and cross-controller coordination before real dispatch. A session prompted by the current process must be observed busy before success; fast work missed between polls can remain reserved until restart or timeout. The agreed restart rule accepts an idle, ready session with recorded work as success.
- The execution timeout is configurable but disabled by default. Persistent-fetch alert timing and delivery, stale-lock warning threshold and human recovery steps, and logging retention and monitoring remain deferred. Fetch failures are logged each pass; a separate alert is not implemented.

## Recent context

- User requested autonomous implementation of the full sequence flow for this session. Implemented the core reconciliation, integrations, recovery and locking. Verification: 40 manager tests and 101 scheduler tests passed; manager build and application/test typechecks passed. No live agents or user database were started or changed.
- Resumed the project, checked source and shared SQL against the notes, and recorded the stale URL-column statement. No services or implementation work were started.
- User requested a compact handoff to reduce resume context usage and asked the `project-resume` skill to exclude package directories such as `node_modules`. Full previous per-prompt history is preserved in [the archive](session-history-archive.md).
