# Apps project: don't forget

Estimated reading time: 2 minutes (150 WPM)

## Before the first joint test

- Starting the resource manager can dispatch real work and move cards. Use an isolated test board and agent workspace, and monitor the run. Don't start services without a request.
- Set `VIKUNJA_PROJECT_ID` and `VIKUNJA_VIEW_ID` for the intended board in `.env.local`; the existing `CTR_*` IDs are different variable names and are not read by these apps.
- Verify both apps can use the same prepared database, including its schema and valid agent rows with reachable URLs. Don't run seed or drop scripts against a user database without authorization.
- Check for competing controllers and review the resource manager's [first-run reminders](../agent-resource-manager/docs/dont-forget.md). Deployed API compatibility remains unverified; the user previously chose to skip that verification.
- The manager can leave `resource-manager-pass` or `ticket-scheduling` locks after a crash; recovery needs human review. The execution timeout is configurable but has no default.

## Agent instructions

- The user intends to write `coordination.md`; don't assume its contents or location.
- Preserve the `agents/manifests.md` symlink and make its target available in containers when changing manifest versions. Recreate existing agent containers when authorized if they don't yet have the Compose mount.
- Keep the [session handoff](session-context.md) current after each user prompt; archive older history when needed.
