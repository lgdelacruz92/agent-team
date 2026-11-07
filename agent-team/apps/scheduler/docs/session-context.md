# Scheduler session context

Estimated reading time: 7 minutes (150 WPM)

## Purpose

The user is developing `scheduler/` as version 2 of the ticket scheduler. Its goal is to schedule Vikunja tickets to OpenCode agents. The user is unhappy with `frontend-ctr` because its implementation is difficult to follow; the new scheduler should be easier to understand.

The user also hopes the scheduling system can serve as a blueprint for many applications. The project goal is recorded in `docs/project.md`.

## Current state

- `scheduler/` is a standalone TypeScript and Express scaffold with SQLite persistence.
- It has generic state endpoints, domain stores for tickets, agents and assignments, and interfaces for future components.
- Scheduling and worker dispatch are not implemented yet. Vikunja Kanban fetching is implemented as a standalone component, not wired into the app. `frontend-ctr` remains separate.
- The SQLite stores and HTTP scaffold are implemented. Component implementation has started, but the scheduler workflow, ticket sync, and card moves remain unfinished.
- The user prefers to start with the scheduler database, thinking about the data before the scheduling workflow.
- The first implemented method is `SchedulerDatabaseInterface.getReadyTickets`. The user initially deferred `VikunjaInterface`, then asked to implement Vikunja tickets next.
- The ready-ticket lookup selects local tickets whose status is exactly `Ready` or `Retry`, in local ID order, without changing their stored statuses. Both statuses are conceptually ready to schedule. Dependency and priority rules are not implemented.
- The Vikunja fetch is scoped to the user's existing Kanban board for this session. `frontend-ctr` uses one project and view; that is API reference, not a design to copy automatically.

## Intended communication

`docs/architecture.comm.md` diagrams the proposed flow: fetch Vikunja tickets, save them locally, select a ready ticket, ask the Agent Manager to assign it, record the assignment, and move the Vikunja ticket to In progress. If no agent is available, retry later. The user moved this diagram into `docs/` during this session.

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
- The user requested committing the session's scheduler changes: Kanban fetching, conceptual readiness for Retry tickets, tests, interfaces, and documentation.
