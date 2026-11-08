# Apps project session context

Estimated reading time: 4 minutes (150 WPM)

## Working agreement

- After each user prompt, update this handoff with relevant context, decisions, and project status alongside the requested work. Keep it concise; archive older history if it grows, and read the archive only when a specific question requires it.
- Use **open** only for topics not yet discussed. Distinguish decisions, deferred choices, and implementation details.
- A resume request authorizes context gathering and note updates, not implementation, starting services or agents, infrastructure changes, or commits.

## Current focus

Prepare for the first test run of the Ticket Scheduler and Agent Resource Manager together. The user wants these notes at the `apps/` level because the work spans both projects and their parent setup.

The scheduler reserves tickets and agents in a shared SQLite database. The resource manager checks agents, dispatches assignments, and reconciles execution and card movement. Starting the manager can dispatch real work, change agent status, and move Vikunja cards. Do not start it merely to resume the project.

The resource manager's [session context](../agent-resource-manager/docs/session-context.md) and [setup](../agent-resource-manager/docs/setup.md) describe implementation decisions and prerequisites. The scheduler's [setup](../scheduler/docs/setup.md) covers its database needs. Some older scheduler documentation describes manager integration as future work; the newer manager handoff records implemented integration. Check source when details matter.

## Current state

- `docker-compose.yaml` includes `scheduler` and `agent-resource-manager`. Both use `${ENV_FILE:-.env.local}` and mount `shared-db/` at `/shared-db`; Compose sets both database paths to `/shared-db/db.sqlite`. The scheduler exposes port 3300 on localhost.
- Both images built and Compose configuration validated. The apps were not started for that validation; this is not a successful joint test run.
- `.env.local` contains `CTR_PROJECT_ID` and `CTR_VIEW_ID`, but not the `VIKUNJA_PROJECT_ID` and `VIKUNJA_VIEW_ID` read by these two apps. The user needs to provide the appropriate board IDs before startup.
- `shared-db/db.sqlite` exists, but its schema and agent rows have not been verified here. Both apps require an already prepared, shared database; neither creates or migrates the schema on startup.
- Controlled tests exist, but compatibility with deployed OpenCode and Vikunja APIs and cross-controller coordination remain unverified. The user previously chose to skip deployed API verification; that is not evidence it passed.

## Decisions and deferred work

- **Decided:** The user rearchitected the system. Keep agent skills and capability guidance, but remove the obsolete ticket and task workflow from agent definitions.
- **Decided:** Each agent reads the stable `agents/manifests.md` link. Compose mounts the `agents/` directory into each agent container, preserving the symlink. The current target, `agents/manifests/manifest.0.0.0.md`, is empty.
- **Deferred:** The user plans to create a separate `coordination.md` describing agent collaboration. Its contents and location have not been specified.
- **Deferred:** Populate the shared manifest when the user provides or requests its instructions.
- See [don't forget](dont-forget.md) for first-run reminders.

## Recent context

- Removed the outdated `docs/dev-process.md` and `docs/frontend-ctr-proposal.md` at the user's request.
- User clarified that these notes belong in `apps/docs/`, not `agents/docs/`, and that the focus is the first joint scheduler/resource-manager test run.
- Added both Node apps to Compose with shared database access and `.env.local` configuration; built images without starting the apps.
- Updated agent definitions and added the stable manifest link and container mounts. The symlink was checked in a test container. Existing agent containers need recreation to receive the mount if not yet recreated.
