# Resource Manager: don't forget

Estimated reading time: 2 minutes (150 WPM)

## Before real dispatch

- Verify the OpenCode session routes, response shapes, readiness timestamps, and Vikunja task and card operations against controlled deployments. Tests currently use fakes, not deployed services.
- Resolve the fast-task gap: a prompt sent in the current process must be observed busy before success; a task that finishes between polls can remain reserved until restart or be marked failed at a configured timeout. Restart accepts recorded work with an idle, ready session as successful, per the agreed recovery rule.
- Decide an execution timeout value. `RESOURCE_MANAGER_EXECUTION_TIMEOUT_MS` is optional and has no default.
- Decide persistent task-fetch alert timing and delivery. Failures are logged each pass; a separate alert is not implemented.
- Decide stale-lock warning thresholds and human recovery steps. A crash can leave `resource-manager-pass` or `ticket-scheduling` locked; neither is automatically cleared.
- Check cross-controller coordination, actual shared database schema, agent provisioning, and monitoring before allowing real dispatch. Never run the seed or drop scripts on a user database without authorization.

## Verification already done

- Controlled tests cover startup, recovery, missing sessions, uncertain prompts, failures, completion retries, lock contention, and the scheduler's retry limit against a shared in-memory database.
- The manager and scheduler have not been tested together against deployed OpenCode and Vikunja services.
