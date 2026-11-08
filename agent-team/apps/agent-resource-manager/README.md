# Agent resource manager

Estimated reading time: 2 minutes (150 WPM)

This app will watch Ticket Scheduler assignments and reconcile real agent resources. Its current loop checks registered agents and flags unreachable ones, but does not dispatch work or reconcile assignments.

## Run

Requires Node.js 22.13 or newer.

```sh
npm install
npm run dev
```

Starting the app immediately contacts registered agents and can change their database status to `needs_review`. It checks again every 30 seconds by default; `RESOURCE_MANAGER_POLL_MS` changes the interval. Stop it with Ctrl+C. To run the compiled app, use `npm run build` followed by `npm start`. Run tests with `npm test`.

The default database is `apps/shared-db/db.sqlite`, shared with the Ticket Scheduler. `RESOURCE_MANAGER_DB_PATH` overrides it; if either app is overridden, ensure both still point to the same file.

Set `OPENCODE_SERVER_PASSWORD` and, if needed, `OPENCODE_SERVER_USERNAME` for Basic authentication; the username defaults to `opencode`. These credentials are used for every registered server. A human must prepare the shared database and its agent rows first; see [setup](docs/setup.md).

Only an `unreachable` result sets `needs_review`. An `unknown` result or missing URL is logged and leaves the existing status unchanged, so the Ticket Scheduler may still select an agent whose stored status is `idle`. A recovered agent is not automatically cleared from `needs_review`.

For the shared database prerequisite, see [setup](docs/setup.md).

**Start here:** read the [data design](docs/data.md) and [session context](docs/session-context.md) for the agreed directions and remaining work. The scheduler's [shared data reference](../scheduler/docs/shared-data.md) describes its side of the integration; check the scheduler source before implementing it.

These notes are context for future work, not authorization to start agents, modify infrastructure, or implement the app without a request.

For session decisions and current progress, read [session context](docs/session-context.md).

For the initial direction, see the [proposed flowchart](docs/flowchart.md) and [build proposal](docs/proposal.md).
