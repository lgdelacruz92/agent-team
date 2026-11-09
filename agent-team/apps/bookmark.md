# Apps project bookmark

Estimated reading time: 3 minutes (150 WPM)

## Current task: unattended agent decisions

- A successful joint test against deployed services has not been confirmed. Do not start a factory or change running services without a request: the manager can dispatch real work and move Vikunja cards.
- The original scheduler and resource manager are currently running, as is the original frontend controller, which reports unhealthy. Check for competing controllers and board settings before any test. Original backend and frontend containers occupy ports 4097 and 4098; the scheduler occupies 3300.
- Port 4098 investigation: the original frontend server responds and reports a running session for Vikunja ticket 37, `Login To listing page`. Its question form was still pending when the user asked how to attach: implement navigation after login, or open an existing app's listings page? The shared database records its assignment and execution as in progress. The container's image ID differs from the current `opencode-frontend:local` tag. No session or service was changed; don't restart or answer the form without authorization.
- User wants unattended server agents to make reasonable decisions rather than ask humans, with later correction possible. Added the shared autonomy rule to the manifest, removed conflicting frontend and CTO approval requirements, and added the V2 question-tool hard-deny policy and manifest instruction to `opencode.json`. The four running original agents' API config entries show both settings loaded; no question invocation was tested. `opencode.json` is Git-ignored, so its policy will not travel through Git. Existing pending forms are not resolved by this update.
- The current manager treats an idle agent as successful even when its report says blocked, so a safe blocker outcome still needs an explicit design and implementation. No manager changes were made.
- Frontend and backend factories use separate databases. The backend targets project 3, view 16; its Compose services mount `backend-factory/db/`. The documented convenience link `backend-factory/db.sqlite` is currently missing, but Compose does not use that link. Do not recreate it without a task requiring it.
- Before a monitored test, verify an isolated board and workspace, matching board settings, prepared database/schema and agent reachability, locks, and any port conflicts. Deployed API compatibility and cross-controller coordination remain unverified; the user previously chose to skip deployed API verification.
- Remember regular agent-session cleanup; its mechanism and schedule are deferred. The planned `coordination.md` content and location are also deferred.

More first-run details: [legacy reminders](docs/dont-forget.md). Project handoff: [session context](docs/session-context.md).
