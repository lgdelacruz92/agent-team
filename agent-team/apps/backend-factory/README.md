# Backend factory

Estimated reading time: 2 minutes (150 WPM)

Runs the backend agent, Ticket Scheduler, and Agent Resource Manager together for Vikunja project `3`, view `16`.

## Start

From this folder:

```sh
docker compose up --build
```

**Starting the factory can dispatch real work and move Vikunja cards.** Verify the board, agent, workspace, and database first. Do not run another controller against the same board at the same time.

## Configuration and state

- `.env.local` links to `../.env.local`. The shared file supplies `VIKUNJA_URL`, `VIKUNJA_API_TOKEN`, and OpenCode authentication. Compose explicitly sets the scheduler and manager's project and view IDs, overriding frontend settings in the environment file.
- `db.sqlite` links to `db/db.sqlite`, a separate database for this factory. Both apps mount its directory, including SQLite's WAL and shared-memory files. It has the shared schema and an idle backend agent at `http://backend:4096`; confirm the agent is reachable and ready before starting. The apps do not create or migrate the database.
- The backend is published on `127.0.0.1:4097`; the scheduler health endpoint is on `127.0.0.1:3301`. These ports must be free. The original backend also uses port `4097`.
- The backend uses `../workspace`, the existing agent instructions, plugins, and OpenCode configuration. Its OpenCode data persists in a factory-specific Docker volume. The shared manifest currently points agents to `/workspace/local-markets-app`; confirm this workspace is appropriate for backend work.
- If either link is missing, recreate it with `ln -s ../.env.local .env.local` or `ln -s db/db.sqlite db.sqlite` from this folder. Prepare the targets before starting.

If the backend database is missing, prepare a **new** database using `../shared-db/seed.sql` and register an agent. See the [Resource Manager setup](../agent-resource-manager/docs/setup.md). Never run the seed against an existing database.
