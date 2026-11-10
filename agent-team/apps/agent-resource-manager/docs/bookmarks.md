# Resource Manager bookmark

Estimated reading time: 4 minutes (150 WPM)

## Current task

- Refactored `_reconcile` in `src/components/assignment-reconciler.ts` into shorter, descriptive private methods for starting, recovering, and monitoring work. Lint, typecheck, and all 57 tests passed.
- User prefers short, readable functions whose names explain what they do.
- ESLint requires TypeScript private class methods to start with `_`. Use `npm run lint`.
- npm audit reports a moderate minimatch advisory in the linting dependencies; ESLint 10 does not support Node 23.

## Previous task: PR merge policy

- Explore a proposed policy: an agent worker transitions to idle once its PR has been merged to main. Discussion only; no implementation authorized.
- Decisions: while the PR waits for review or merge, the worker stays reserved for that ticket to handle requested changes. Session idleness does not mean the worker is available. When the PR merges to main, mark the ticket Done and complete the assignment as well as transitioning the worker to idle.
- For the proof of concept, a person manually gives the worker PR review feedback. Automation can be considered later if the concept is proven; it is deferred.
- Created [manual-done.md](../manual-done.md) as a human procedure for moving the ticket to Done, completing the execution and assignment, and setting the agent idle after a merge. The scheduler requires both idle status and no incomplete assignment. Current manager behavior can release the worker before merge, so the procedure requires stopping it while waiting. PR tracking and other outcomes are not yet specified.

## Previous task: first test run

- The latest discussion covered what remains before a first test run; no live run was started. The user previously chose to skip deployed API verification, not to treat it as completed.
- Before any requested run, check an isolated board and agent workspace, a prepared shared database, matching configuration, competing controllers, and monitoring. The prerequisites below remain reminders, not authorization to start services.

## Before real dispatch

- Verify the OpenCode session routes, response shapes, readiness timestamps, and Vikunja task and card operations against controlled deployments. Tests currently use fakes, not deployed services.
- Fast tasks can be detected from a newer completed busy/idle interval compared with the pre-prompt baseline. If timestamps are absent or do not advance, the manager still cannot recognize a task missed between polls; it waits or reaches the configured timeout. Restart accepts recorded work with an idle, ready session as successful, per the agreed recovery rule.
- Decide an execution timeout value. `RESOURCE_MANAGER_EXECUTION_TIMEOUT_MS` is optional and has no default.
- Document human recovery steps for stale locks. The manager logs locks older than two minutes, but neither `resource-manager-pass` nor `ticket-scheduling` is cleared automatically after a crash.
- Check cross-controller coordination, actual shared database schema, agent provisioning, and monitoring before allowing real dispatch. Never run the seed or drop scripts on a user database without authorization.

## Verification already done

- Controlled tests cover fast-task timestamps, startup, recovery, missing sessions, uncertain prompts, failures, completion retries, lock contention, and the scheduler's retry limit against a shared in-memory database.
- The manager and scheduler have not been tested together against deployed OpenCode and Vikunja services.
