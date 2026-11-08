# Resource Manager setup

Estimated reading time: 3 minutes (150 WPM)

## Shared database prerequisite

Someone must set up the shared SQLite database before the Resource Manager and Ticket Scheduler can work together. Both apps must use the same database file. The Ticket Scheduler does not create the database or tables or run migrations at startup; setup and migration are external responsibilities.

A human is responsible for prepopulating the `agents` table and making sure its entries are valid at startup. The preparation and validation procedure has not been specified. The Resource Manager is still intended to monitor agents during operation; startup validity does not guarantee continued reachability.

The existing scheduler expects `tickets`, `agents`, and `assignments` with the fields and relationships in its [table models](../../scheduler/src/db/stores-doc.md). The integration also requires `executions`, `locks`, and the agent's OpenCode URL, as described in the [Resource Manager data design](data.md) and the scheduler's [shared data reference](../../scheduler/docs/shared-data.md).

For a **new** database, the manual [seed.sql](../../shared-db/seed.sql) creates all five tables. From `agent-team/apps`, run:

```sh
sqlite3 -bail /absolute/path/to/new.sqlite < shared-db/seed.sql
```

SQLite 3.37 or newer is required. The script does not migrate existing tables and stops if any already exist. The human must then add and validate real agent rows; the example in the SQL file is commented out. Set `idle` only for agents ready for scheduling, with URLs the Resource Manager can reach.

The separate [drop.sql](../../shared-db/drop.sql) permanently deletes all five tables and their contents. Stop both apps and back up the database before running it. From `agent-team/apps`:

```sh
sqlite3 -bail /absolute/path/to/shared.sqlite < shared-db/drop.sql
```

The scheduler's [setup guide](../../scheduler/docs/setup.md) also describes its older manual seed, which creates only the execution and lock tables in an already prepared database.

Both apps default to `agent-team/apps/shared-db/db.sqlite`, regardless of their working directory. The scheduler's `SCHEDULER_DB_PATH` and the Resource Manager's `RESOURCE_MANAGER_DB_PATH` override their respective defaults. If either is overridden, ensure both resolve to the same file and can access its directory. SQLite WAL is the current same-host proof-of-concept choice.

The shared database file must already exist. The Resource Manager requires the `agents` table to have `id`, `name`, `status`, and `url` columns; it does not create or migrate them. Starting it checks registered URLs, can dispatch assignments and move cards, and can set unreachable agents to `needs_review`. Its 30-second default check interval can be changed with `RESOURCE_MANAGER_POLL_MS`.

The manager reads assignments and executions and uses the scheduler's `ticket-scheduling` lock for coordinated completion. It also holds `resource-manager-pass` during each manager pass; a crash may leave either lock for human review. Setting up a database alone does not validate the deployed OpenCode or Vikunja APIs.
