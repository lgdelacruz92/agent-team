# Ticket Scheduler setup

Estimated reading time: 3 minutes (150 WPM)

## Shared database prerequisite

Someone must set up the shared SQLite database before the Ticket Scheduler and Resource Manager can work together. Both apps must use the same database file. The Ticket Scheduler does not create the database file or tables, or run migrations, at startup. Database setup and migration are external responsibilities.

The current scheduler requires the existing `tickets`, `agents`, and `assignments` tables and their expected columns. See [current scheduler table models](../src/db/stores-doc.md). The database must preserve their unique and foreign-key relationships, including `tickets.vikunja_task_id` and assignment references. `tickets.present_on_board` must exist; older databases are not automatically migrated.

The scheduler requires the `locks` and `executions` tables for coordination and retry checks. After the existing scheduler tables are set up, a person can create the two shared tables by running this from `apps/scheduler`:

```sh
npm run seed -- /absolute/path/to/scheduler.sqlite
```

Replace the example path with the existing database path. The script does not create the database or the `tickets`, `agents`, and `assignments` tables. It creates the two shared tables if missing, checks an existing table for required fields and constraints, and leaves existing rows intact. If an existing table is incompatible, it fails and rolls back rather than migrating it. Do not run it against a live database until you have checked the path and schema.

For the planned cross-app integration, the shared database also needs the agent's OpenCode URL. See [shared data reference](shared-data.md). The seed script does not add that URL or provide a complete database setup. Do not treat the test fixture as a production setup script.

Point `SCHEDULER_DB_PATH` at the existing database. Its default is `data/scheduler.sqlite` relative to the scheduler's working directory. The path must resolve to the same file the Resource Manager will use. SQLite WAL is the current same-host proof-of-concept choice; ensure both processes can access the database and its directory.

On startup, the scheduler checks its original table columns and fails if the file is missing or those columns are unavailable. This check does not validate every constraint or the execution and lock tables. A missing lock table makes passes fail; a missing execution table makes a `Retry` count fail. The scheduler's lock, retry checks, and flagging are implemented, but Resource Manager integration is not. The Vikunja board must have exactly one column named `Flagged tickets`.

See the [scheduler README](../README.md) for the remaining configuration and run commands.
