# Ticket Scheduler setup

Estimated reading time: 2 minutes (150 WPM)

## Shared database prerequisite

Someone must set up the shared SQLite database before the Ticket Scheduler and Resource Manager can work together. Both apps must use the same database file. The Ticket Scheduler does not create the database file, its tables, or migrations. Database setup and migration are external responsibilities.

The current scheduler requires the existing `tickets`, `agents`, and `assignments` tables and their expected columns. See [current scheduler table models](../src/db/stores-doc.md). The database must preserve their unique and foreign-key relationships, including `tickets.vikunja_task_id` and assignment references. `tickets.present_on_board` must exist; older databases are not automatically migrated.

For the planned cross-app integration, the shared database also needs the agreed `executions` and `locks` tables and the agent's OpenCode URL. See [shared data reference](shared-data.md). The exact SQLite schema and provisioning process for these additions have not been finalized, and no complete shared-database setup script is provided here. Do not treat the test fixture as a production setup script.

Point `SCHEDULER_DB_PATH` at the existing database. Its default is `data/scheduler.sqlite` relative to the scheduler's working directory. The path must resolve to the same file the Resource Manager will use. SQLite WAL is the current same-host proof-of-concept choice; ensure both processes can access the database and its directory.

On startup, the scheduler checks the columns it currently uses and fails if the file is missing or those columns are unavailable. This check does not validate every constraint or the planned execution and lock tables. The Resource Manager integration, shared lock, and attempt-limit enforcement are not implemented yet.

See the [scheduler README](../README.md) for the remaining configuration and run commands.
