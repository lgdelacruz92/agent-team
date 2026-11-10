# Agent resource manager session context

Estimated reading time: 11 minutes (150 WPM)

## Working agreement

- After each user prompt, update these notes with relevant context, decisions, and project status alongside the requested work. Keep this handoff concise; preserve historical detail in [the archive](session-history-archive.md). Read the archive only when a specific historical question requires it.
- Favor understandable code over speed and practical handling with human monitoring.
- Prefer short, readable functions with names that explain what the code does.
- For this session, the user preferred autonomous, long-running implementation. After that implementation, they asked to discuss the three remaining real-dispatch items one at a time.
- Use **open** only for topics not yet discussed. Distinguish decisions, deferred choices, and implementation details.
- A resume request authorizes context gathering and note updates, not implementation, starting services, infrastructure changes, or commits.

## Current state

- The loop checks registered agents and reconciles incomplete assignments. It fetches tasks, creates and recovers sessions, records executions, reports running work, and uses the scheduler's shared lock to move final cards and release reservations. Controlled tests cover both apps with a shared in-memory database; deployed API compatibility still needs verification.
- Starting the manager can dispatch real work, change agent status, and move cards. Do not start it without a request. Unknown agent responses and missing URLs leave status unchanged; recovered agents are not automatically cleared from `needs_review`. An unchanged `idle` row may still be selected by the scheduler.
- A separate `resource-manager-pass` lock prevents overlapping manager instances. A crash can leave that lock or `ticket-scheduling` behind; both require human review and are not cleared automatically. See [bookmark](bookmarks.md).
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

- User requested breaking the long `_reconcile` method into logical private functions. Extracted starting and recovering work, session monitoring, progress, and failure handling without changing the intended flow; added a fetch-order recovery test. Lint, typecheck, and all 57 tests passed; the focused reconciliation suite also passed after the test was strengthened.
- User requested extracting the finished-execution branch from `_reconcile` for readability. Moved it into `_handleFinishedExecution` without changing its retry, abort, agent-state, or completion behavior. Added focused coverage; lint, typecheck, and all 56 tests passed.
- User requested an underscore prefix for private methods. Added an ESLint rule for TypeScript private class methods, renamed existing methods and calls, and added a rule test. Private fields and other methods are unaffected. Lint, typecheck, and all 54 tests passed.
- User requested a linter. Added ESLint with recommended JavaScript and TypeScript rules for source and tests, plus `npm run lint`; documented intentional exceptions for lock-release error handling. Lint, typecheck, and all 53 tests passed. npm audit reports a moderate minimatch advisory in the new development dependencies; ESLint 10 does not support Node 23.
- User asked for a plain-English explanation of `src/components/assignment-reconciler.ts` lines 43–55: handling completed executions, agent status, abort attempts, and assignment completion. No code changes requested.
- User requested an exact manual method to make a worker eligible after its PR merges. Created [manual-done.md](../manual-done.md): pause controllers, verify the merge and database, back up, move the card, and manually complete the execution and assignment and set the agent idle in one transaction. Tested the SQL against in-memory examples. The current manager can release an idle session before a PR merges, so it must be stopped while waiting; no live database or service was changed.
- For now, a human will manually set the agent's status to idle in the shared database after the PR merges. The scheduler also requires the assignment to be complete before selecting the agent; the later manual procedure covers that completion and the ticket move.
- For the proof of concept, a person manually gives PR review feedback to the worker. Automating feedback may be considered later if the concept is proven; it is deferred, not a current requirement.
- User confirmed that merging the PR to main should also mark the ticket Done and complete the assignment. This is a policy decision for discussion, not implemented behavior.
- User confirmed that while a PR waits for review or merge, the worker stays reserved for that ticket so it can handle requested changes. Session idleness and worker availability are distinct; PR tracking and assignment completion details remain to be discussed.
- User wants this session limited to exploring a policy change: an agent worker transitions to idle once its PR has been merged to main. This is a proposal, not an implemented or fully specified policy. How it affects assignment completion, PR tracking, and other outcomes remains to be discussed.
- User requested project resume. Reviewed the handoff, relevant manager code, shared seed, and neighboring notes; no services or implementation work were started. The scheduler's older shared-data reference incorrectly describes completion coordination as unimplemented and stale-lock warning decisions as deferred. A neighboring handoff also notes that an idle session is treated as successful even if an agent report says blocked; a safe blocker outcome still needs design and implementation.
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
