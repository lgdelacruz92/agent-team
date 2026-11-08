# Apps project: don't forget

Estimated reading time: 3 minutes (150 WPM)

## Where we left off

- We left off testing the Ticket Scheduler and Agent Resource Manager together. A successful joint test run has not yet been confirmed.
- Remember to implement regular session cleanup for agents. The cleanup mechanism and schedule have not been specified.
- `frontend-factory/` packages the frontend agent, scheduler, and manager. Its database is a local copy, separate from the parent; its environment links to the parent file. Its factory containers have not yet been started together.
- `backend-factory/` packages the backend agent, scheduler, and manager for project `3`, view `16`, with its own database. Its images were built, but the factory has not been started. Its backend shares host port `4097` with the original backend. Verify the board, backend agent, database state, and workspace before starting.

## Before continuing the joint test

- Starting the resource manager can dispatch real work and move cards. Use an isolated test board and agent workspace, and monitor the run. Don't start services without a request.
- Set `CTR_PROJECT_ID` and `CTR_VIEW_ID` for the intended board in the shared `.env.local`; the factory maps those to `VIKUNJA_*` IDs unless explicit `VIKUNJA_*` values are set.
- Verify both apps can use the same prepared database, including its schema and valid agent rows with reachable URLs. Don't run seed or drop scripts against a user database without authorization.
- Check for competing controllers and review the resource manager's [first-run reminders](../agent-resource-manager/docs/dont-forget.md). Deployed API compatibility remains unverified; the user previously chose to skip that verification.
- The manager can leave `resource-manager-pass` or `ticket-scheduling` locks after a crash; recovery needs human review. The execution timeout is configurable but has no default.

## Agent instructions

- The user intends to write `coordination.md`; don't assume its contents or location.
- Preserve the `agents/manifests.md` symlink and make its target available in containers when changing manifest versions. Recreate existing agent containers when authorized if they don't yet have the Compose mount.
- Keep the [session handoff](session-context.md) current after each user prompt; archive older history when needed.
