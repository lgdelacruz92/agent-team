# Ticket Scheduler session context

Estimated reading time: 7 minutes (150 WPM)

## Purpose and working agreement

- `apps/scheduler` is the **Ticket Scheduler**, a standalone TypeScript/Express app that connects Vikunja tasks with AI agents. The user wants understandable code and hopes the system can become a reusable blueprint. See [project goal](project.md).
- Focus on the scheduler unless the user requests otherwise. After each prompt, update notes in `scheduler/docs/` with relevant decisions, progress, and context, alongside the requested work. Preserve existing work and check the working tree before changes.
- Favor clarity over speed. Keep implementation classes in `src/components/` for now. Treat `frontend-ctr` as reference, not a design to copy automatically.
- Discuss decisions one at a time when requested. **Open** means not yet discussed; an agreed direction, a deferred decision, or unfinished implementation is not open.
- The user sees no urgent scheduler work right now and removed `docs/dont-forget.md`. If future scheduler work needs a reminder, add a `dont-forget.md` document then. Resource Manager work belongs in its own project.

## Current scheduler behavior

- `index.ts` wires the components and starts a non-overlapping loop after the HTTP server listens. Each pass holds the shared `ticket-scheduling` lock across board fetch, synchronization, and scheduling. A held lock skips the pass; failures are logged and retried on the next pass.
- Vikunja is authoritative for card column status. Each successful fetch is atomically synced to SQLite, including board presence; missing cards and their assignments remain stored, but missing cards cannot be newly assigned. Failed fetches do not change presence or assign work.
- The scheduler considers present `Ready` and `Retry` tickets without incomplete assignments, in local ID order, and handles at most one per pass. It chooses the first exact `idle` agent without an incomplete assignment. An assignment with `completed_at` empty reserves both ticket and agent, regardless of status text; creation records `assigned` without changing ticket or agent status. It does not start an agent.
- For a `Retry` ticket, count executions with `work_requested_at` recorded across its assignments. The first attempt counts as 1; `SCHEDULER_MAX_ATTEMPTS` defaults to 3 and is configurable. At the limit, move the card to the board's single exact `Flagged tickets` column instead of assigning it. The local status is refreshed on a later fetch.
- If counting or flagging fails, stop the pass without assigning and release the lock. After a failed or uncertain move, fetch the board again next pass: a card already flagged is ineligible; a card still in `Retry` can be moved again. A persistently failing first ticket can delay later work.
- `/health` reports process liveness; `/status` reports in-memory scheduling activity and outcomes, not worker health. A pass skipped due to lock contention may report success. Long-waiting incomplete `assigned` records generate warnings without being released.

## Shared data and boundaries

- The scheduler expects an existing SQLite database; startup does not create the file, tables, or migrations. Both apps default to `apps/shared-db/db.sqlite`; `SCHEDULER_DB_PATH` and `RESOURCE_MANAGER_DB_PATH` independently override that default. A person can run `npm run seed -- <existing-database-path>` from `apps/scheduler` to create the shared `executions` and `locks` tables; it does not create the original tables or add an agent URL. See [setup](setup.md).
- Both apps must use the same database and the same lock name and owner-token protocol. The scheduler side is implemented; the Resource Manager side is not. Potentially stale lock rows are left for human review, not automatically cleared. The warning threshold and recovery steps are deferred.
- The scheduler trusts the `agents` table and does not provision agents, start sessions, monitor workers, or set their real-world status. The user tolerates occasional agent-data inconsistencies. How a human handles a flagged ticket or lets it run again is outside this app; do not invent an automated reset workflow.
- The Resource Manager is a separate app in `apps/agent-resource-manager`. It checks agents and flags unreachable ones `needs_review`, but does not dispatch work or reconcile assignments. Its agreed direction includes moving failed work to `Retry`, moving other lifecycle cards, recording executions, and coordinating completion. Its work is tracked in its own [notes](../../agent-resource-manager/docs/dont-forget.md), not in the scheduler.
- A request sent but not recorded in `work_requested_at` does not count; the user accepts possible duplicate work. The user assumes humans do not manually move cards and expects useful inconsistency reporting, but broad coverage is not verified. Logging implementation, retention, and monitoring details are deferred.
- Both apps have not yet been tested together. Do not start real agents, change live infrastructure, or run the seed script on the user's database without authorization. The user prefers practical handling of common cases with human monitoring over excessive complexity.

## Recent checkpoint

- Commit `0b7901b` stopped automatic database and table creation and documented external setup.
- Commit `b7af67a` added the scheduler-side shared lock, attempt counting, manual seed script, exhausted-retry flagging, tests, and documentation cleanup.
- Last verification for that work: **100 tests passed**, application and test typechecks passed, and the build passed. Tests used controlled databases and fake Vikunja responses; no live board or user database was changed.
- The user removed the completed scheduler handoffs and checklists. Relevant decisions are in [shared data](shared-data.md); no urgent scheduler task is currently recorded.
- The README's intended-watcher section says the scheduler does not move cards; that sentence is stale for `Flagged tickets`. The scheduler does perform that specific move. Check source and newer notes when documentation conflicts.
- The user requested this compact session context so a future project-resume session retains recent changes and decisions without the old play-by-play, then requested a commit.
- User requested both apps use `shared-db/db.sqlite`. Updated their defaults to resolve that same file independently of the working directory, retaining their individual environment overrides. The user database was not opened or changed.

## References

- [Scheduler README](../README.md): configuration, endpoints, and operation.
- [Shared data](shared-data.md): execution and lock models, retry decisions, and coordination boundaries.
- [Setup](setup.md): database prerequisites and manual seed command.
- [Communication diagram](architecture.comm.md) and [loop walkthrough](scheduler-loop.md): flow and learning references. The repository's VS Code launch configuration includes `Scheduler: debug loop tests`.
- [Resource Manager data design](../../agent-resource-manager/docs/data.md) and [session context](../../agent-resource-manager/docs/session-context.md): its own lifecycle and implementation details.
