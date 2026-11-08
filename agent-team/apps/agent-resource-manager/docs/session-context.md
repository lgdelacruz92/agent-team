# Agent resource manager session context

Estimated reading time: 5 minutes (150 WPM)

## Working agreement

- After each user prompt, update these notes with relevant context, decisions, and project status alongside the requested work. Keep this handoff concise; preserve historical detail in [the archive](session-history-archive.md). Read the archive only when a specific historical question requires it.
- Favor understandable code over speed and practical handling with human monitoring.
- Use **open** only for topics not yet discussed. Distinguish decisions, deferred choices, and implementation details.
- A resume request authorizes context gathering and note updates, not implementation, starting services, infrastructure changes, or commits.

## Current state

- `ResourceManager.runOnce()` reads registered agents, checks their OpenCode servers, and marks unreachable agents `needs_review`. The loop runs non-overlapping passes and retries after errors. Unknown responses and missing URLs leave status unchanged; a recovered agent is not automatically cleared. An `idle` row left unchanged may still be selected by the Ticket Scheduler.
- Starting the manager contacts registered agents and can update their status. Do not start it without a request. Its OpenCode client's other operations are unimplemented; actual deployed API compatibility still needs controlled verification.
- Assignment reconciliation, session dispatch and recovery, execution tracking, Vikunja integration, outcome handling, and manager-side completion locking are not implemented. See [don't forget](dont-forget.md) and the [sequence diagram](sequence-diagram.md).
- The Ticket Scheduler is a separate app. It reserves tickets and agents through incomplete assignments, implements its side of the shared lock, and enforces a configurable retry limit of three total recorded attempts by default. It does not start or monitor agents.
- Both apps default to `../../shared-db/db.sqlite` and have independent path overrides. A human prepares the database, populates agents, and ensures their entries are valid at startup. The [fresh seed](../../shared-db/seed.sql) includes `agents.url`; an older statement in [data design](data.md) says the current table lacks it. An existing database's actual schema has not been verified. The example `agents.sql` inserts a frontend agent and duplicates it if rerun; neither seed nor drop should be run on a user database without authorization.

## Agreed directions

- Fetch the full Vikunja task description before starting. If fetching fails, keep the assignment reserved, retry, and alert a human if failure persists; it is not an agent attempt.
- Create an execution after fetching the task and before creating the session; save the session ID before sending work. Count an attempt only when `work_requested_at` is recorded after sending. A sent but unrecorded request does not count; the user accepts possible duplicate work. See [data design](data.md) for approved restart cases.
- The manager decides outcomes: an agent idle and ready means success without verifying task results; too slow or unreachable means failure. Try to stop a failed session, but retries may proceed without confirmation. Flag unreachable agents for human review and use another available agent.
- Move successful work to `Done` and failed work to `Retry`. The Ticket Scheduler moves exhausted retries to `Flagged tickets`. Assume humans do not manually move cards; broad inconsistency reporting is not established.
- Coordinate final card movement and assignment completion with the same `ticket-scheduling` database lock the Ticket Scheduler holds across board fetch, sync, and scheduling. If unavailable, retain the reservation and retry later. The manager must follow the agreed owner-token protocol and failure handling in [data design](data.md).

## Remaining work and deferred details

- Continue the agent-check slice into assignment reconciliation, integration contracts, execution/session tracking, and manager-side locking. Test restart, failure, and completion cases with controlled dependencies, then test both apps together before real dispatch.
- Agent execution timeout, persistent-fetch alert timing and delivery, stale-lock warning threshold and human recovery steps, and logging implementation, retention, and monitoring remain deferred. Startup, readiness, and cross-controller coordination still have implementation details to resolve; inspect the real OpenCode API and existing frontend controller rather than assuming behavior.
- The user previously requested starting implementation with entity interfaces; those initial interfaces now exist. Extend them for execution and lock operations as needed.

## Recent context

- Resumed the project, checked source and shared SQL against the notes, and recorded the stale URL-column statement. No services or implementation work were started.
- User requested a compact handoff to reduce resume context usage and asked the `project-resume` skill to exclude package directories such as `node_modules`. Full previous per-prompt history is preserved in [the archive](session-history-archive.md).
