# Agent resource manager session context

Estimated reading time: 7 minutes (150 WPM)

## Working agreement

- After each user prompt, update these notes with relevant context, decisions, and project status alongside the requested work. Keep this handoff concise; preserve historical detail in [the archive](session-history-archive.md). Read the archive only when a specific historical question requires it.
- Favor understandable code over speed and practical handling with human monitoring.
- For this session, the user preferred autonomous, long-running implementation. After that implementation, they asked to discuss the three remaining real-dispatch items one at a time.
- Use **open** only for topics not yet discussed. Distinguish decisions, deferred choices, and implementation details.
- A resume request authorizes context gathering and note updates, not implementation, starting services, infrastructure changes, or commits.

## Current state

- The loop checks registered agents and reconciles incomplete assignments. It fetches tasks, creates and recovers sessions, records executions, reports running work, and uses the scheduler's shared lock to move final cards and release reservations. Controlled tests cover both apps with a shared in-memory database; deployed API compatibility still needs verification.
- Starting the manager can dispatch real work, change agent status, and move cards. Do not start it without a request. Unknown agent responses and missing URLs leave status unchanged; recovered agents are not automatically cleared from `needs_review`. An unchanged `idle` row may still be selected by the scheduler.
- A separate `resource-manager-pass` lock prevents overlapping manager instances. A crash can leave that lock or `ticket-scheduling` behind; both require human review and are not cleared automatically. See [don't forget](dont-forget.md).
- The Ticket Scheduler is a separate app. It reserves tickets and agents through incomplete assignments, implements its side of the shared lock, and enforces a configurable retry limit of three total recorded attempts by default. It does not start or monitor agents.
- Both apps default to `../../shared-db/db.sqlite` and have independent path overrides. A human prepares the database, populates agents, and ensures their entries are valid at startup. The [fresh seed](../../shared-db/seed.sql) includes `agents.url`; an existing database's actual schema has not been verified. The example `agents.sql` inserts a frontend agent and duplicates it if rerun; neither seed nor drop should be run on a user database without authorization.

## Agreed directions

- Fetch the full Vikunja task description before starting. If fetching fails, keep the assignment reserved, retry, and log each failure to the terminal; it is not an agent attempt. No separate alert is needed for this prototype.
- Create an execution after fetching the task and before creating the session; save the session ID before sending work. Count an attempt only when `work_requested_at` is recorded after sending. A sent but unrecorded request does not count; the user accepts possible duplicate work. See [data design](data.md) for approved restart cases.
- The manager decides outcomes: an agent idle and ready means success without verifying task results; too slow or unreachable means failure. Try to stop a failed session, but retries may proceed without confirmation. Flag unreachable agents for human review and use another available agent.
- Move successful work to `Done` and failed work to `Retry`. The Ticket Scheduler moves exhausted retries to `Flagged tickets`. Assume humans do not manually move cards; broad inconsistency reporting is not established.
- Coordinate final card movement and assignment completion with the same `ticket-scheduling` database lock the Ticket Scheduler holds across board fetch, sync, and scheduling. If unavailable, retain the reservation and retry later. The manager must follow the agreed owner-token protocol and failure handling in [data design](data.md).

## Remaining work and deferred details

- The user asked to skip deployed API verification and knows how to connect Vikunja; actual API compatibility and cross-controller coordination remain unverified. Fast work can now be recognized by a newer completed busy/idle interval compared with its pre-prompt baseline. If timestamps are absent or do not advance, the assignment can still wait until restart or timeout. The agreed restart rule accepts an idle, ready session with recorded work as success.
- The execution timeout is configurable but disabled by default. The manager logs locks held for more than two minutes and waits for a human; it never automatically removes them. Human recovery steps, logging retention, and monitoring remain deferred.

## Recent context

- User asked what remains before a first test run. Key prerequisites: isolated test board and agent workspace, both apps on the same prepared database and board, exported environment settings, no competing controller, and monitoring; deployed API behavior remains unverified. No live run was started.
- User set a two-minute stale-lock threshold and chose terminal warnings with human recovery, not automatic removal. The manager checks both lock names and warns about invalid timestamps; recovery steps remain to be documented. All 50 manager tests, the build, and application/test typechecks passed.
- User chose terminal logging for every failed task fetch; no separate alert is needed for the prototype. Existing reconciliation already logs each failed fetch and keeps the reservation. Next discuss stale-lock recovery.
- User asked what is next after fast-task detection. Continue with the remaining alerting and stale-lock recovery item, discussing decisions one at a time.
- User approved using session busy/idle timestamps to recognize work completed between polls. Implemented an in-memory pre-prompt baseline and validated newer completed intervals, including reused sessions and timeout cases. All 47 manager tests, the build, and application/test typechecks passed. Controlled tests do not establish deployed API compatibility.
- User has a Vikunja server and knows how to hook it up; they asked to skip deployed API verification. This is not evidence the manager's deployed API assumptions were tested.
- User wants to go through deployed API verification, fast-task readiness, and alerting/stale-lock recovery one item at a time, starting with deployed API verification.
- User requested autonomous implementation of the full sequence flow for this session. Implemented the core reconciliation, integrations, recovery and locking. Verification: 40 manager tests and 101 scheduler tests passed; manager build and application/test typechecks passed. No live agents or user database were started or changed.
- Resumed the project, checked source and shared SQL against the notes, and recorded the stale URL-column statement. No services or implementation work were started.
- User requested a compact handoff to reduce resume context usage and asked the `project-resume` skill to exclude package directories such as `node_modules`. Full previous per-prompt history is preserved in [the archive](session-history-archive.md).
