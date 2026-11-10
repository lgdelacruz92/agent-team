# Apps project bookmark

Estimated reading time: 4 minutes (150 WPM)

## Current task: project task lists

- Added `docs/tasks.md` for this project and updated project initialization and resume to create and read task lists for other projects when opened. Existing task lists are preserved.

## Previous task: unattended agent decisions

- A successful joint test against deployed services has not been confirmed. Do not start a factory or change running services without a request: the manager can dispatch real work and move Vikunja cards.
- On an earlier resume, the original scheduler and resource manager were running, as was the original frontend controller, which reported unhealthy. Original backend and frontend containers occupied ports 4097 and 4098; the scheduler occupied 3300. Docker was unreachable on the latest resume, so current service and port state is unverified. Check for competing controllers and board settings before any test.
- Earlier port 4098 investigation: the original frontend server reported a running session for Vikunja ticket 37, `Login To listing page`, with a pending question form. The shared database then recorded its assignment and execution as in progress. Its current state was not rechecked on resume; don't restart or answer the form without authorization.
- User wants unattended server agents to make reasonable decisions rather than ask humans, with later correction possible. Added the shared autonomy rule to the manifest, removed conflicting frontend and CTO approval requirements, and added the V2 question-tool hard-deny policy and manifest instruction to `opencode.json`. The four running original agents' API config entries show both settings loaded; no question invocation was tested. `opencode.json` is Git-ignored, so its policy will not travel through Git. Existing pending forms are not resolved by this update.
- The current manager treats an idle agent as successful even when its report says blocked, so a safe blocker outcome still needs an explicit design and implementation. No manager changes were made.
- Security: the ignored `opencode.json` contains an embedded credential; review and rotate it if exposed. Do not copy the credential into project notes.
- Frontend and backend factories use separate databases. The backend targets project 3, view 16; its Compose services mount `backend-factory/db/`. The documented convenience link `backend-factory/db.sqlite` is currently missing, but Compose does not use that link. Do not recreate it without a task requiring it.
- Before a monitored test, verify an isolated board and workspace, matching board settings, prepared database/schema and agent reachability, locks, and any port conflicts. Deployed API compatibility and cross-controller coordination remain unverified; the user previously chose to skip deployed API verification.
- Remember regular agent-session cleanup; its mechanism and schedule are deferred. The planned `coordination.md` content and location are also deferred.

## Configuration reference

- Startup configuration question answered: V2 discovers `opencode.json(c)` from the selected directory and ancestors; the installed CLI lists no `--config` flag. `opencode debug config` lists configuration sources. No config or service changes were made.

## Exploration tasks

- Design a CTO verification loop.

More first-run details: [legacy reminders](dont-forget.md). Project handoff: [session context](session-context.md).
