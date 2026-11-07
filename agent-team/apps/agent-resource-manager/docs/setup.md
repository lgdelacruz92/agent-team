# Resource Manager setup

Estimated reading time: 2 minutes (150 WPM)

## Shared database prerequisite

Someone must set up the shared SQLite database before the Resource Manager and Ticket Scheduler can work together. Both apps must use the same database file. The Ticket Scheduler does not create the database or tables or run migrations at startup; setup and migration are external responsibilities.

The existing scheduler expects `tickets`, `agents`, and `assignments` with the fields and relationships in its [table models](../../scheduler/src/db/stores-doc.md). The planned integration also requires `executions`, `locks`, and the agent's OpenCode URL, as described in the [Resource Manager data design](data.md) and the scheduler's [shared data reference](../../scheduler/docs/shared-data.md). The scheduler's [setup guide](../../scheduler/docs/setup.md) describes a manually run script for the execution and lock tables; it does not create the original tables or add the agent URL. No complete shared-database setup script is provided yet.

Configure both apps to access the same database file and its directory. The scheduler uses `SCHEDULER_DB_PATH`; see its [setup guide](../../scheduler/docs/setup.md). SQLite WAL is the current same-host proof-of-concept choice.

The Resource Manager currently runs an idle loop and has no database integration or database-path configuration. Setting up a database alone does not make the apps work together; the manager still needs execution tracking and must use the scheduler's `ticket-scheduling` lock for coordinated completion.
