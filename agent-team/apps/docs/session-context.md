# Apps project session context

Estimated reading time: 8 minutes (150 WPM)

## Working agreement

- After each user prompt, update this handoff with relevant context, decisions, and project status alongside the requested work. Keep it concise; archive older history if it grows, and read the archive only when a specific question requires it.
- Use **open** only for topics not yet discussed. Distinguish decisions, deferred choices, and implementation details.
- A resume request authorizes context gathering and note updates, not implementation, starting services or agents, infrastructure changes, or commits.

## Current focus

The user reports that the Ticket Scheduler worked with the frontend project ID. They want a `frontend-factory` that runs the frontend agent, scheduler, and Agent Resource Manager together from its own Compose folder and `.env.local`. A similar backend factory is planned later. These notes belong at the `apps/` level because the work spans both projects and their parent setup.

The scheduler reserves tickets and agents in a shared SQLite database. The resource manager checks agents, dispatches assignments, and reconciles execution and card movement. Starting the manager can dispatch real work, change agent status, and move Vikunja cards. Do not start it merely to resume the project.

The resource manager's [session context](../agent-resource-manager/docs/session-context.md) and [setup](../agent-resource-manager/docs/setup.md) describe implementation decisions and prerequisites. The scheduler's [setup](../scheduler/docs/setup.md) covers its database needs. Some older scheduler documentation describes manager integration as future work; the newer manager handoff records implemented integration. Check source when details matter.

## Current state

- `frontend-factory/docker-compose.yaml` defines the three services. Its `.env.local` links to the apps-level file, and `db.sqlite` links to `../shared-db/db.sqlite`. The scheduler and manager mount the parent database directory so they also share SQLite's WAL files.
- All three factory images built and Compose configuration validated. One-off checks verified both app containers can read the shared database and board settings, and the frontend container can read its instructions and workspace. The factory itself has not been started; a joint test run has not been confirmed.
- `docker-compose.yaml` includes `scheduler` and `agent-resource-manager`. Both use `${ENV_FILE:-.env.local}` and mount `shared-db/` at `/shared-db`; Compose sets both database paths to `/shared-db/db.sqlite`. The scheduler exposes port 3300 on localhost.
- The original scheduler, resource manager, and frontend containers were stopped when the factory was created. Don't run the original and factory schedulers against the same board simultaneously.
- The apps-level `.env.local` contains `CTR_PROJECT_ID` and `CTR_VIEW_ID`. The factory's startup script maps them to the apps' `VIKUNJA_*` IDs unless those IDs are explicitly set.
- The shared database passed SQLite's quick integrity check and contains a frontend agent. A complete schema and real agent validation have not been performed. Both apps require an already prepared, shared database; neither creates or migrates the schema on startup.
- Controlled tests exist, but compatibility with deployed OpenCode and Vikunja APIs and cross-controller coordination remain unverified. The user previously chose to skip deployed API verification; that is not evidence it passed.

## Decisions and deferred work

- **Decided:** The user rearchitected the system. Keep agent skills and capability guidance, but remove the obsolete ticket and task workflow from agent definitions.
- **Decided:** Each agent reads the stable `agents/manifests.md` link. Compose mounts the `agents/` directory into each agent container, preserving the symlink. The current target, `agents/manifests/manifest.0.0.0.md`, instructs agents to work tickets in `/workspace/local-markets-app`.
- **Deferred:** The user plans to create a separate `coordination.md` describing agent collaboration. Its contents and location have not been specified.
- **Deferred:** Implement regular session cleanup for agents. The mechanism and schedule have not been specified.
- **Deferred:** Create a similar backend factory. Different boards require separate databases as well as the appropriate agent and board configuration; changing only the project ID is not enough if they share a database.
- See [don't forget](dont-forget.md) for first-run reminders.

## Recent context

- Replaced the factory's database and environment copies with links to their parent files at the user's request. Preserved backups of the former copies in the session temporary directory. Factory apps now mount the shared database directory and map existing `CTR_*` board IDs at startup.
- Created `frontend-factory/` with a local Compose file, environment copy, and isolated copy of the current shared database at the user's request. Built the images and checked configuration and mounts without starting the factory.
- User asked to record where testing left off and to remember regular agent-session cleanup.
- Fixed the resource manager's server-wide and session-specific current-state checks to use OpenCode's process-local `/api/session/active` endpoint; historical timestamps remain available for fast-task detection. Added regression and controlled-flow tests. The fixed client reported idle against the live frontend server with a read-only check; running services were not restarted.
- Investigated the manager's repeated `Agent 1: busy` logs. Agent 1 points to the frontend server on host port 4098 and its database status is `idle`. The manager infers busy from any historical session with a busy timestamp but no later idle timestamp; one session from November 3 has no idle timestamp. OpenCode's `/api/session/active` reports zero active sessions. The manager's session-specific activity check uses the same timestamp assumption. No code or agent state was changed.
- Removed `shared-db/db.sqlite` from all local branch histories and the index after the user approved stopping the scheduler. Preserved the database and uncommitted changes; a consistent database backup is in the session's temporary directory. No remote push was made. The old database remains in the remote history and may remain in local reflogs and unreachable objects. The local `origin/main` tracking ref was removed to avoid retaining the old history; fetching it before the remote is cleaned will reintroduce that history.
- Fixed the scheduler to accept omitted bucket `tasks` as empty while retaining pagination safeguards. Regression tests cover empty columns, incomplete pagination, and moving to an empty flagged column. The fixed parser fetched 12 live tickets using a read-only call; the running scheduler was not restarted or changed.
- Diagnosed the running scheduler's `invalid Kanban bucket` error: the live Vikunja response omits `tasks` for three empty buckets (`count: 0`), while the scheduler accepts only an array or `null`. Reproduced the actual error with a read-only API call; no fix was requested or applied.
- Clarified that the scheduler validates Vikunja API responses before syncing them into the shared tickets table; the code already implements synchronization. This is separate from assuming database tables are valid.
- Explained how the scheduler validates Vikunja tasks in `scheduler/src/components/vikunja.ts`; no application code was changed.
- Added the user's instruction to work tickets in `/workspace` to the shared manifest.
- Removed the outdated `docs/dev-process.md` and `docs/frontend-ctr-proposal.md` at the user's request.
- User clarified that these notes belong in `apps/docs/`, not `agents/docs/`, and that the focus is the first joint scheduler/resource-manager test run.
- Added both Node apps to Compose with shared database access and `.env.local` configuration; built images without starting the apps.
- Updated agent definitions and added the stable manifest link and container mounts. The symlink was checked in a test container. Existing agent containers need recreation to receive the mount if not yet recreated.
