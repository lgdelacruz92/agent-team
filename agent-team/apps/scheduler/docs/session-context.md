# Scheduler session context

Estimated reading time: 32 minutes (150 WPM)

## Purpose

The user is developing `scheduler/` as version 2 of the ticket scheduler. Its goal is to schedule Vikunja tickets to OpenCode agents. The user is unhappy with `frontend-ctr` because its implementation is difficult to follow; the new scheduler should be easier to understand.

The user also hopes the scheduling system can serve as a blueprint for many applications. The project goal is recorded in `docs/project.md`.

## Current state

- `scheduler/` is a standalone TypeScript and Express scaffold with SQLite persistence.
- It has a health endpoint, domain stores for tickets, agents and assignments, and interfaces for future components. The generic state store and endpoints were removed.
- `Scheduler.runOnce()` orchestration and Vikunja Kanban fetching are implemented. `index.ts` constructs the components and starts a non-overlapping scheduling loop after the HTTP server starts. Worker dispatch is not implemented. `frontend-ctr` remains separate.
- The SQLite stores, HTTP scaffold, ticket sync, assignment creation, and local agent selection are implemented. Local assignment reserves an agent; OpenCode session dispatch, lifecycle card movement, and completion/release handling belong to the future watcher and remain unfinished. The scheduler separately flags exhausted retries.
- Agent selection uses exact status `idle` and no assignment with null `completedAt`, in local agent ID order. Assignment creation saves ownership atomically without changing ticket or agent status. The future watcher owns reporting real agent status; an incomplete assignment prevents double booking while the agent still reports idle. Agents are prepopulated externally with real IDs; startup does not seed agents or discover OpenCode workers.
- The user prefers to start with the scheduler database, thinking about the data before the scheduling workflow.
- The first implemented method is `SchedulerDatabaseInterface.getReadyTickets`. The user initially deferred `VikunjaInterface`, then asked to implement Vikunja tickets next.
- The ready-ticket lookup selects tickets present in the latest successful board fetch whose status is exactly `Ready` or `Retry` and which have no incomplete assignment, in local ID order. Dependency and priority rules are not implemented.
- The Vikunja fetch is scoped to the user's existing Kanban board for this session. `frontend-ctr` uses one project and view; that is API reference, not a design to copy automatically.

## Intended communication

`docs/architecture.comm.md` diagrams the scheduler flow: fetch Vikunja tickets, save them locally, select an unassigned ready ticket, and ask the Agent Manager to record an assignment. If no agent is available, retry later. The future watcher will move the card after the agent starts.

## Working agreement

Focus this session on `scheduler/`. After each user prompt, update notes in `scheduler/docs/` with relevant conversation context and where the project stands, in addition to carrying out the requested work. Treat `frontend-ctr` as reference, not a design to copy automatically.

The user values code they can understand over development speed or efficiency. Favor clarity and learn their coding preferences from their feedback throughout the process.

Put implementation classes in `src/components/` for now; the user may rename the folder later.

The user requested that all current changes be committed.
The user then added the project goal and requested another commit.

## Session resumed

- The user asked to read `apps/`, focusing on `scheduler/` and its previous-session notes in `docs/`.
- Read the scheduler documentation, source, and tests, plus the surrounding application layout, shared process/proposal docs, and Compose configuration.
- The implementation still matches the checkpoint above. The HTTP scaffold is not wired to the domain stores or scheduler components.
- Existing uncommitted work includes this context file, `src/components/scheduler-database.ts`, and `test/scheduler-database.test.ts`; preserve it.
- No implementation changes or test runs were requested or performed during this context refresh.

## Vikunja fetching discussion

- The user asked for recommendations on implementing `VikunjaInterface.getTickets()`; no implementation has been requested yet.
- Recommended one configured project and Kanban view, using a small class in `src/components/` with explicit connection settings and injectable `fetch` for tests. The user subsequently scoped this session to their existing board.
- Fetch the board and translate task ID, title, priority, and bucket title into `VikunjaTicket`. Return all board statuses; leave readiness filtering and database writes outside this component.
- Use bearer authentication, a request timeout, HTTP and response-shape checks, and verified pagination behavior. Return an empty list only for a genuinely empty board; throw on failures rather than disguising them as no work.
- Initially recommended normalizing known bucket names. The user's later clarification settled on preserving the exact existing column titles. Test mapping, empty buckets, failures, invalid responses, and pagination.
- `frontend-ctr/src/services/vikunja.service.ts` provides an existing board endpoint example, not a design requirement; its large `per_page` setting alone does not establish that every task is returned.
- The user confirmed this session concerns their existing Kanban board only. Its columns represent ticket status at each workflow stage. Read that board and derive each ticket's status from its column; other view types and multi-project support are outside the current scope.
- The user confirmed the board's exact column names: `Ready`, `In progress`, `Retry`, and `Done`. Use these titles as ticket statuses without renaming them.
- The user clarified that `Retry` is conceptually ready and must also be selected by `getReadyTickets()`. Updated the component, interface comment, and tests accordingly; local ID ordering remains unchanged. Tests cover both eligible statuses, excluded statuses, and preserving `Retry` in storage.
- Verification after this change: all 11 tests passed (`npm test`), and `npm run typecheck` passed.

## Vikunja getTickets implementation

- The user requested implementation of `VikunjaInterface.getTickets()`.
- Added `src/components/vikunja.ts`: `Vikunja` implements only `getTickets`, matching the partial-component pattern used by `SchedulerDatabase`. `markInProgress` remains unimplemented.
- Constructor settings are explicit: server base URL (without `/api/v1`), API token, project ID, and Kanban view ID. Optional page size defaults to 50; timeout defaults to 30 seconds per request. `fetch` can be injected for tests. Actual board IDs and credentials were not supplied or guessed.
- Reads `/api/v1/projects/{projectId}/views/{viewId}/tasks`, preserving column titles as statuses and returning all columns. Maps task ID, title, and priority; does not save tickets or filter readiness.
- Checked upstream Vikunja `task_collection.go` and `kanban.go`: Kanban pagination is per column, with a `count` for each bucket. Fetch successive pages until each bucket's unique-card count is satisfied; do not rely on outer pagination headers or requested page size. Validate external data and fail on stalled pagination. Deduplicate task IDs.
- Authentication uses a bearer token. HTTP errors omit response bodies and credentials. Network, timeout, JSON, and validation failures reject the operation rather than returning partial results. Pagination is not an atomic snapshot of a changing board.
- Added `test/vikunja.test.ts` and README usage instructions. All 22 tests passed; application typecheck, build, and a separate typecheck of the new test file passed. Tests use fake responses; no live board request was made.
- The component is not wired into the Express scaffold. Next work can implement local ticket sync or card movement when requested.
- The user requested committing the session's scheduler changes: Kanban fetching, conceptual readiness for Retry tickets, tests, interfaces, and documentation. Committed as `903208c`.

## Scheduler runOnce implementation

- The user requested only `SchedulerInterface.runOnce()`, explicitly instructing us to trust the dependency interfaces and not implement anything outside that interface.
- Added `src/components/scheduler.ts`. Its constructor receives `VikunjaInterface`, `SchedulerDatabaseInterface`, and `AgentManagerInterface`; its only workflow method is `runOnce`.
- One pass awaits ticket fetching, saves each fetched ticket sequentially, asks the database for ready tickets, and attempts to assign only the first returned ticket. Selection trusts database readiness and ordering; no new priority policy is introduced.
- No ready ticket or a null assignment ends the pass. No internal polling, retry loop, or attempt to assign another ticket. A later call can retry.
- Agent Manager owns assignment persistence and the local ticket update. After it returns an assignment, the scheduler awaits `markInProgress` using the Vikunja task ID, not the local ticket ID.
- Errors propagate and stop the pass. No rollback, recovery policy, additional dependency implementation, or application wiring was added.
- Added `test/scheduler.test.ts` with interface doubles, covering call order, one-ticket selection, Retry eligibility, empty cases, and failures at each dependency step. All 32 tests and application/new-test-file typechecks passed.
- The user requested committing the runOnce implementation, its tests, and these session notes. Committed as `647fb26`.
- The user asked whether `index.ts` would call `runOnce`. At that point nothing called it in the running app. Recommended `index.ts` for constructing dependencies and a non-overlapping caller-controlled loop. No wiring was added during that discussion.

## Startup runOnce wiring

- The user requested calling `runOnce`, permitting an Agent Manager class and constructor only. Explained that incomplete dependency classes cannot satisfy the interfaces; the user explicitly selected “Allow throwing placeholders” rather than implementing real behavior.
- Added `src/components/agent-manager.ts` with a constructor receiving the scheduler database and a throwing `assignTicket` placeholder. Added throwing `saveTicket`, `createAssignment`, and `markInProgress` methods to complete the dependency interfaces. These placeholders do not return fake success or report unavailability.
- Updated `index.ts` to construct Vikunja, a shared domain database connection, TicketStore, SchedulerDatabase, AgentManager, and Scheduler. It calls `runOnce` once after the HTTP server starts listening, catches and logs errors, and leaves the HTTP scaffold available. No repeated loop or real assignment/movement logic was added.
- Configuration requires exported `VIKUNJA_URL`, `VIKUNJA_API_TOKEN`, `VIKUNJA_PROJECT_ID`, and `VIKUNJA_VIEW_ID`. No real IDs or credentials were supplied or guessed. Missing/invalid settings prevent startup; `.env.local` is not loaded automatically.
- Shutdown waits for the startup pass before closing both state and domain SQLite connections. With fetched cards, the current pass fails explicitly at the unfinished `saveTicket` method.
- Added placeholder tests and a subprocess startup test against a local fake board. Verified one board request, explicit placeholder failure, continued HTTP health access, and clean SIGTERM shutdown. No request was made to the user's board. All 36 tests, application and new-test-file typechecks, and build passed.
- The user requested committing the startup wiring, Agent Manager shell, approved placeholders, configuration, tests, and documentation. Committed as `ca529c8`.
- The user asked why `runOnce` has no loop. The startup request was interpreted as a single call, not continuous polling, despite the earlier discussion of a caller-controlled loop. Clarified that ongoing scheduling requires an external loop awaiting each pass, handling errors, waiting, and repeating until shutdown. At that point no automatic later retry occurred. The user subsequently requested continuous scheduling.

## Continuous scheduling

- The user authorized continuous scheduling. Added `src/scheduler-loop.ts`, accepting `SchedulerInterface`, polling delay, and an abort signal. `runOnce` itself remains unchanged.
- The first pass runs immediately after the HTTP server starts. Each pass is awaited, errors are logged, and the loop waits before trying again. No overlapping passes or tight retry loop, including when no ticket or agent is available.
- `SCHEDULER_POLL_MS` configures the delay after each pass, defaulting to 30,000 milliseconds. Reject non-integers, non-positive values, and values above Node's timer limit of 2147483647 milliseconds.
- SIGINT, SIGTERM, or server failure stops the loop and cancels any polling wait. An active pass completes before SQLite closes. Unexpected loop-level failure logs an error and initiates shutdown.
- Existing dependency placeholders remain untouched; continuous scheduling still logs their explicit failures until the real methods are implemented.
- Added loop tests for repetition, error recovery, non-overlap, aborting the wait, and waiting for active work. Updated the real-entry-point test to verify repeated failed passes against a local fake board and clean shutdown. All 40 tests, application/new-test-file typechecks, and build passed. README reflects continuous operation.
- The user requested committing the continuous scheduling loop, configuration, shutdown wiring, tests, and documentation.

## Loop-test debugging

- The user wants to step through scheduler loop tests in VS Code to understand the loop.
- Added `Scheduler: debug loop tests` to the repository-root `.vscode/launch.json`, preserving the frontend controller's Docker attach configuration. Launches Node with `tsx` and the test runner, targets `test/scheduler-loop.test.ts`, and automatically attaches to test child processes.
- This launch sets `SCHEDULER_TEST_DEBUG=1`. Loop tests omit their two-second timeouts only when that flag is set, so breakpoint pauses do not fail them. Ordinary test runs retain their timeouts.
- Useful starting breakpoints: the first test's `await runSchedulerLoop(...)`, its fake `runOnce`, and `src/scheduler-loop.ts` at `await scheduler.runOnce()`.
- Verified all 40 tests pass normally, and all four loop tests pass with the debug launch's command and environment. VS Code breakpoint attachment was not exercised here.

## Loop walkthrough

- Explained that the promise-based `setImmediate()` yields to Node's event loop rather than waiting for a fixed polling delay.
- The user requested a Mermaid decision flowchart and a source snippet explaining every line of the scheduling loop.
- Added `docs/scheduler-loop.md` with the flowchart, current source, source-line explanations, shutdown and error paths, and a guide to stepping through the first loop test. No loop behavior changed.

## saveTicket implementation

- The user requested implementing only `SchedulerDatabase.saveTicket`.
- Uses the existing TicketStore: look up the Vikunja task ID, create if missing, otherwise update the existing local ID. Copies title, status, and priority exactly; repeated saves do not create duplicates. No deletion of missing board cards, readiness normalization, or priority policy was added.
- Database errors propagate. If an update unexpectedly returns no ticket, the method rejects rather than reporting success. Store calls are synchronous, with no await between lookup and write; this is not a cross-process atomic upsert.
- Assignment creation, agent assignment, and Vikunja movement remain throwing placeholders. A pass now saves fetched cards and, if Ready or Retry tickets exist, fails at `AgentManager.assignTicket`.
- Added tests for creation, updates preserving local identity and unrelated tickets, repeated saves, and database failures. Updated placeholder and startup tests; the startup test verifies repeated passes persist one ticket across shutdown and create no assignments. All requests use a local fake board, not the user's server.
- Verification: all 44 tests passed, application and changed-test-file typechecks passed, and build passed. README and current-state notes reflect ticket persistence.
- The user requested committing ticket persistence; committed as `14b65db`.

## Remaining method implementations

- The user authorized implementing `SchedulerDatabase.createAssignment`, `AgentManager.assignTicket`, and `Vikunja.markInProgress`.
- `SchedulerDatabase` now takes the shared SQLite connection and constructs its stores. `createAssignment` uses `BEGIN IMMEDIATE`, verifies the persisted ticket is Ready or Retry, checks the agent is idle with no incomplete assignment, and rejects existing active ticket ownership. Saves the assignment using supplied status/time, changes the local ticket status, and marks the agent busy. Every write commits together or rolls back; store CRUD remains unrestricted.
- `AgentManager` receives the scheduler database plus AgentStore and AssignmentStore on the shared connection. Chooses the first eligible agent by local ID, returning null only when none is available. Records assignment status `running`, ticket status `In progress`, and the current UTC timestamp. Database failures propagate.
- Incomplete assignments are identified by null `completedAt`, not by assignment status. Existing active ticket ownership is returned unchanged when retried, including after a board refresh or manager restart. This prevents duplicate assignment when local writes succeed but a Vikunja move fails. Board refresh may temporarily restore the local ticket to Ready/Retry; a later successful fetch synchronizes In progress.
- `markInProgress` validates the Vikunja task ID, reads the first board page, requires exactly one column titled `In progress`, and posts the move to the scoped bucket endpoint. Uses bearer authentication and a per-request timeout; errors omit response bodies and tokens. Does not cache the bucket ID or guess one. Checked the upstream Vikunja TaskBucket model/router for the POST path and fields; the existing controller served only as reference.
- Updated `index.ts` wiring. Startup does not invent agents or live connection settings. Registration is explicit through AgentStore. No OpenCode sessions are started; `running` is local ownership bookkeeping, not evidence of worker execution. Completion monitoring and releasing busy agents remain future work.
- Replaced obsolete placeholder tests with assignment tests and added agent-manager and movement coverage. Tests cover successful claims, eligibility, duplicate prevention, completed history, write failures and rollback, HTTP/data/network errors, and local fake-board startup with no agents or a failed move followed by success. No request was made to the user's board.
- Verification: all 68 tests passed, application and all-test-file typechecks passed, and build passed. README documents registration, statuses, transaction boundaries, retry behavior, and the remaining dispatch/completion work.

## External agent synchronizer proposal

- The user says agent IDs will be pre-populated and can be assumed to correspond to real agents. A separate app will watch the database and synchronize its real agents according to table state.
- At that point, the exact integration contract was still undecided, including state ownership, how the other app starts work and reports completion or failure, and how retries avoid duplicate execution. The later decision on agent status ownership is recorded below.

## Agent status ownership

- The user wants the future watcher, not the scheduler, to update `agents.status` to reflect real agents. Assignment creation leaves agent status unchanged; an incomplete assignment reserves an idle agent until completion.
- The user requested new assignments start as `assigned`, not `running`. Existing records are unchanged and may still say `running` without confirming execution. The watcher is not implemented.
- The user requested a handoff for the future watcher. See `docs/agent-resource-manager.md` for the scheduler contract, Vikunja timing, failure cases, and unresolved integration decisions.

## Scheduler reliability discussion

- The user wants a practical assessment of common operating cases, not exhaustive edge-case hardening; a human can monitor and restart the app.
- Initially identified gaps included Vikunja refreshes overwriting local ticket status, failed scheduler-owned moves blocking later work, and health reporting only process liveness. Later decisions below clarify status ownership and move card movement out of the scheduler. The app does not move completed cards to Done or release assignments automatically.
- The user accepted adding `present_on_board` so tickets absent from a successful fetch cannot receive new assignments. Board sync updates presence atomically; missing ticket records and existing assignments remain. Failed fetches leave presence unchanged. Existing databases migrate with tickets absent until the next successful sync.
- The user chose Vikunja as the authority for card column status, while the database owns assignments and agent state. Manual card moves do not automatically change assignments or stop agents; any additional handling remains a separate decision.
- The user decided the future watcher will move cards to `In progress` after confirming startup. The scheduler no longer moves cards or changes ticket status during assignment; it skips tickets with incomplete assignments. Completion versus card movement still needs coordination to prevent reassigning a completed ticket left in `Ready` or `Retry`.
- The user requested warnings for assignments stuck in `assigned`, without a new database column or automatic release. The scheduler checks before each pass, defaults to a 10-minute threshold, and repeats warnings no more often than the same configurable interval. Warnings include assignment, ticket, and agent IDs and waiting time; they do not prove failure or block other work.
- The user requested a scheduler status endpoint in addition to process liveness. `/status` reports whether a scheduling pass is running, the last success and failure times, and the last completed result. It resets on restart; a successful pass does not imply work was assigned or the watcher is healthy.
- The user created `apps/agent-resource-manager/` and requested a handoff for a future agent. Its README points to `docs/agent-resource-manager.md`, which compiles the agreed boundaries, scheduler behavior, manual testing, and unresolved watcher design questions.

## Ticket Scheduler session

- The user refers to `apps/scheduler` as the Ticket Scheduler and plans a change there. Reviewed the Resource Manager flowchart and the scheduler docs, including `docs/retry-limit-handoff.md`; the change details have not yet been specified.
- The user confirmed the note-taking working agreement: update `scheduler/docs/` with relevant conversation context and project state after each prompt, alongside the requested work.
- The user asked whether the retry-limit handoff is ready to implement. The responsibility split is agreed, but the limit, shared execution/counting contract, human reset behavior, failure handling, and safe cross-app coordination remain open; no implementation was authorized by this question.
- The user wants to discuss the open retry-limit decisions one at a time, starting with the total attempt limit.
- The user wanted to finish the discussion when opening this project with another agent. The questions were originally recorded in `open-discussion.md`, which was later removed after the discussion and scheduler implementation progressed.
- The user requested a commit of only the Ticket Scheduler updates, leaving Resource Manager changes separate.
- User requested updating `docs/open-discussion.md` to reflect the later Resource Manager decisions and creating `docs/missing-features.md` for remaining cross-app integration work. Updated both documents from the current Resource Manager design and scheduler source; marked the older retry-limit handoff as historical because it contains superseded questions. No implementation was requested.
- User requested `dont-forget.md` in both apps' docs for high-priority work left for later. The Ticket Scheduler list points to implementation of the retry-limit handoff and the cross-app missing features. No implementation was requested.
- User resumed `apps/scheduler` as the Ticket Scheduler using project-resume. Reviewed its handoffs and source and the Resource Manager's shared-data design. Continue the per-prompt notes agreement in this file; no implementation, test run, service startup, or commit was requested. The attempt limit remains unset and shared coordination is not implemented.
- User wants to work on the high-priority tasks in `docs/dont-forget.md` and update that checklist when work is completed. Discuss remaining decisions one at a time; the attempt limit and its configuration remain undecided. Do not mark a task complete until its work is actually done.
- User chose 3 total attempts including the first, configurable. Added `SCHEDULER_MAX_ATTEMPTS` with default 3 and positive-safe-integer validation. This is configuration only: attempt counting, enforcement, and flagging remain unimplemented. Both high-priority checklist items remain incomplete. All 76 tests and application typecheck passed.
- User said what happens after a ticket is flagged, including how to run it again, is up to the human and not this app's concern. Do not invent an automated reset or intervention workflow; the mechanics of any human action were not specified.
- User asked why the scheduler might be unable to read the attempt count if it is in the execution table. The planned count comes from executions with `work_requested_at` linked to the ticket through assignments; the table is not implemented yet. An unavailable count means a read or database failure, not a normal empty result. No failure-handling decision was made.
- User asked for options and tradeoffs when an attempt-count read fails. Discuss stopping the pass and retrying later, skipping that ticket and trying others, or assigning without a reliable count. Recommend stopping the pass and retrying; no option has been approved yet.
- User approved logging an attempt-count read failure, stopping the pass without assigning work, and retrying on the next pass. The behavior is not implemented yet.
- User approved the same fail-safe response for a failed or uncertain move to `Flagged tickets`: log it, stop the pass without assigning work, and fetch the board next pass. If already flagged, leave it alone; if still in `Retry`, try moving it again. This behavior is not implemented yet.
- User corrected the discussion about unreachable-agent review statuses: the Ticket Scheduler is concerned with what it sees in the agents table, while the Resource Manager keeps that data as close to real resources as possible. The user tolerates occasional agent-data inconsistencies. Do not make the Resource Manager's status naming a scheduler decision.
- User asked what still needs discussion about execution counts and shared-lock coordination. Separate the already agreed counting and lock behavior from remaining schema migration and shared-database implementation details; stale-lock warning and human recovery were deferred. Discuss one decision at a time.
- User decided the Ticket Scheduler should not create the new shared tables; assume they are already set up. Both apps use the same SQLite database and tables. Copied the approved Resource Manager execution and lock models into `docs/shared-data.md` for scheduler session handoffs. The current schema lacks those tables, and this documentation does not create or migrate them.
- User clarified that the scheduler should stop creating existing tables too, and requested `docs/setup.md` in both apps documenting external database setup. The scheduler now opens an existing database, checks its current required columns, and fails without creating or migrating anything if the file or schema is missing. Tests explicitly set up isolated schemas; missing, empty, and legacy databases are covered. The setup guides describe the shared prerequisite and the unimplemented integration. All 78 tests, application and test typechecks, and build passed.
- User asked whether all items in `docs/dont-forget.md` are complete. Neither is: configurable attempt limit and database-setup prerequisites are in place, but counting and enforcing attempts, flagging exhausted tickets, shared locking, and cross-app integration and tests remain unfinished.
- User requested committing the current session's scheduler changes and shared-database setup documentation in both apps before continuing.
- User asked where we left off after commit `0b7901b`: both `dont-forget.md` items remain incomplete. Next is implementing execution-count checks and shared-lock coordination against the externally prepared database, followed by flagged-ticket movement and controlled integration tests. The configurable default of 3 attempts exists but is not enforced.
- User requested the scheduler-side shared lock, execution-count checks, and an explicit `seed.ts` script. The scheduler now acquires the `ticket-scheduling` lock across each pass, skips when held, and releases only with its owner token. It counts recorded work requests for `Retry` tickets and blocks exhausted retries; count errors fail the pass. Card movement to `Flagged tickets` remains unimplemented, so exhausted tickets log an error on later passes and may block later tickets. The Resource Manager does not yet use the lock.
- The manual `npm run seed -- <existing-database-path>` command creates only the shared execution and lock tables in an existing scheduler database, preserves existing rows, and refuses incompatible tables without migrating them. It was tested only against disposable databases, not run against the user's database. The scheduler still does not create or migrate tables at startup. Updated setup guides, checklist, and shared-data notes. All 93 tests, application and test typechecks, and build passed.
- User asked which app moves tickets to the flagged column. The agreed responsibility is the Ticket Scheduler: it checks eligible `Retry` tickets and moves exhausted ones to `Flagged tickets`. The Resource Manager moves failed work to `Retry`. The scheduler currently blocks exhausted retries but does not yet move the card.
- User requested implementing the move to `Flagged tickets`. The scheduler now moves an eligible exhausted `Retry` ticket using its Vikunja task ID while holding the shared lock, and does not assign it. It discovers exactly one destination column and uses the scoped authenticated Vikunja move endpoint. Move errors propagate, the lock is released, and the next pass refetches the board. Fake-board tests cover success, failures, an uncertain successful move, and no extra assignments. No live board was contacted. Marked the scheduler-side retry-limit item complete; cross-app integration remains incomplete. All 100 tests, application and test typechecks, and build passed.
- User asked why cross-app integration remains unfinished. The Resource Manager is still an idle scaffold: it does not use the same database and lock protocol, record executions, dispatch or observe agents, or coordinate card movement and assignment completion. The shared database must also be prepared, and both apps need controlled end-to-end tests. Scheduler-side tests use fakes and do not establish that both apps work together.
- User requested recording the cross-app integration status and corrected the terminology: if a direction has been discussed, call the remaining work unfinished, not open. **Open** means a topic not yet discussed; agreed directions, deferred decisions, and implementation details are not open. Updated `docs/missing-features.md` and `docs/open-discussion.md`.
- User clarified that the second item in `docs/dont-forget.md` should be checked because the cross-app integration plan exists. Checked and reworded it to mean the plan is documented, not that implementation is complete; the remaining tasks stay in `docs/missing-features.md`.
- User directed that `scheduler/docs/missing-features.md` must not contain a Resource Manager section because its implementation is not this app's concern. Refocused the checklist on scheduler work and scheduler-facing integration verification, and moved the Resource Manager implementation reminders to its own `docs/dont-forget.md`.
- User said the second Shared data and coordination checklist item, confirming the shared SQLite configuration, is irrelevant as a reminder because it will be addressed later. Removed that item from `docs/missing-features.md`; the shared-database direction remains documented elsewhere.
- User requested deleting `docs/open-discussion.md` and `docs/retry-limit-handoff.md`. Preserved the relevant scheduler decisions in `docs/shared-data.md` and updated links. The earlier `docs/missing-features.md` checklist was later removed too.
- User requested removing `scheduler/docs/agent-resource-manager.md` because that work is tracked in the Resource Manager project. Removed the handoff and redirected its active links to the Resource Manager notes and the scheduler's shared-data reference.
- User requested deleting `scheduler/docs/missing-features.md` and `scheduler/docs/dont-forget.md`: there is nothing urgent for the Ticket Scheduler now. If future scheduler work needs a reminder, add it to a `dont-forget.md` document then. The two-app integration remains unverified; Resource Manager work is tracked in its own project.
- User requested committing the scheduler implementation and the related documentation updates in both apps.
