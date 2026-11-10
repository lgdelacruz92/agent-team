# Coding Standards

Estimated reading time: 6 minutes (150 WPM)

These are working standards inferred from the [scheduler project](../scheduler/). Use its code as a model, not as a mandate to copy its application-specific behavior or technology into every project. Refine these standards as preferences become clearer.

## Design around clear responsibilities

- Give each component a focused job. Keep coordination separate from integration, persistence, monitoring, and application startup.
- Make the main workflow easy to follow: call well-named operations in a clear order and leave the details to the component that owns them.
- Separate low-level data access from business rules. A store can handle records; a higher-level component can enforce rules spanning multiple records.
- Be explicit about what a component does *not* do when that boundary matters. Do not make one operation imply work that another component owns.
- Favor straightforward code and the smallest useful set of dependencies over unnecessary frameworks or layers.

**Model:** `Scheduler.runOnce()` coordinates one pass, while `Vikunja`, `SchedulerDatabase`, and `AgentManager` own distinct responsibilities. See [`scheduler.ts`](../scheduler/src/components/scheduler.ts) and [`scheduler-database.ts`](../scheduler/src/components/scheduler-database.ts).

## Make contracts and dependencies visible

- Define interfaces at meaningful component boundaries. Describe operations in terms of the caller's needs, not storage or transport details.
- Document important guarantees in the contract: ordering, eligibility, side effects, atomicity, and failure behavior where relevant.
- Pass dependencies into components instead of hiding their construction inside the workflow. Assemble concrete components at the application entry point.
- Accept a narrow dependency when only a small capability is needed; do not require an entire service unnecessarily.
- Keep startup and server listening separate from application creation so the app can be tested without starting the whole process.

**Model:** [`scheduler-database.interface.ts`](../scheduler/src/interfaces/scheduler-database.interface.ts), [`index.ts`](../scheduler/src/index.ts), and [`app.ts`](../scheduler/src/app.ts).

## Write readable, explicit TypeScript

- Use strict TypeScript and give domain concepts descriptive names. Name values by their role, including which system owns an ID or status.
- Use explicit types for component contracts and domain data. Use `import type` for type-only dependencies.
- Prefer direct control flow, early returns for clear no-work cases, and small functions with names that explain intent.
- Add short comments for boundaries, non-obvious decisions, and invariants—not a narration of every line.
- Keep formatting consistent with the surrounding project. Scheduler uses two-space indentation, double quotes, and no semicolons; follow those conventions when working there.

**Model:** [`scheduler.ts`](../scheduler/src/components/scheduler.ts), [`vikunja.interface.ts`](../scheduler/src/interfaces/vikunja.interface.ts), and [`tsconfig.json`](../scheduler/tsconfig.json).

## Validate inputs and fail clearly

- Validate configuration at startup and external data at the boundary. TypeScript types do not validate runtime JSON.
- Reject missing, malformed, or out-of-range values with errors that identify the problem. Provide defaults only when they are safe and intentional.
- Do not disguise a failed or incomplete operation as a successful empty result. Propagate errors to the layer responsible for retrying or reporting them.
- Include useful context in errors and logs, but never expose credentials or sensitive response bodies.
- Use timeouts for external requests and detect stalled progress in pagination or other loops.

**Model:** [`config.ts`](../scheduler/src/config.ts) and [`vikunja.ts`](../scheduler/src/components/vikunja.ts).

## Protect state and manage resources

- Treat related state changes as one operation when partial updates would violate an invariant. Use transactions and roll back on failure.
- Recheck critical conditions where the state change is committed, not only before starting it; account for competing processes where applicable.
- Release locks and close resources even when work fails. Preserve the original error if cleanup also fails.
- Make retry and concurrency behavior explicit. Avoid overlapping work when the operation is not designed for it; distinguish a safe retry from an uncertain external outcome.
- Separate process liveness from the health or outcome of background work. Log actionable failures and provide status where it helps operators.
- Shut down cleanly: stop accepting new work, allow active work to finish when appropriate, then release shared resources.

**Model:** [`scheduler-database.ts`](../scheduler/src/components/scheduler-database.ts), [`scheduler-loop.ts`](../scheduler/src/scheduler-loop.ts), and [`index.ts`](../scheduler/src/index.ts).

## Test behavior, including failure paths

- Write tests around observable behavior and contract guarantees, with names that say what should happen.
- Cover successful work, no-work cases, boundaries, invalid input, dependency failures, and cleanup—not just the happy path.
- Inject simple doubles for external services and component boundaries. Check calls, ordering, and absence of forbidden side effects when those are part of the contract.
- Use realistic integration tests for behavior that depends on the real database, including transactions and rollback. Keep test data isolated and close resources afterward.
- Make time and other nondeterministic inputs controllable when tests need to exercise them.
- Provide repeatable commands for tests, type checking, and building, and run the relevant checks for a change.

**Model:** [`scheduler.test.ts`](../scheduler/test/scheduler.test.ts), [`scheduler-database.test.ts`](../scheduler/test/scheduler-database.test.ts), and [`vikunja.test.ts`](../scheduler/test/vikunja.test.ts).

## Document the real system

- Explain how to run, configure, and check the application, including required settings and safe defaults.
- Describe component ownership, important invariants, and operational behavior such as retries, shutdown, and failure handling.
- Distinguish implemented behavior from future plans and known limitations. Do not describe a recorded request as proof that external work happened.
- Keep documentation aligned with the code and tests as behavior changes.

**Model:** [`README.md`](../scheduler/README.md) and [`architecture.comm.md`](../scheduler/docs/architecture.comm.md).
