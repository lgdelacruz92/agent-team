# Frontend factory

Estimated reading time: 2 minutes (150 WPM)

Runs the frontend agent, Ticket Scheduler, and Agent Resource Manager together. Compose reads each service's environment from this folder's `.env.local`; it does not require `--env-file`.

## Start

From this folder:

```sh
docker compose up --build
```

**Starting the factory can dispatch real work and move Vikunja cards.** Check the board, agent, and database before starting. Don't run the old scheduler or resource manager against the same board at the same time.

## Configuration and state

- `.env.local` links to `../.env.local`. Set `VIKUNJA_URL`, `VIKUNJA_API_TOKEN`, `CTR_PROJECT_ID`, and `CTR_VIEW_ID` there. Both apps use the same project and view IDs; explicitly set `VIKUNJA_PROJECT_ID` and `VIKUNJA_VIEW_ID` to override the corresponding `CTR_*` values. A different project can also need a different view ID.
- OpenCode authentication uses `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD`. The frontend's GitHub credentials use `FRONTEND_GITHUB_TOKEN` when set, otherwise `GITHUB_TOKEN`.
- `db.sqlite` links to `../shared-db/db.sqlite`. Both apps mount the parent database directory so the database, WAL, and shared-memory files stay shared with the original apps. Changes affect that same database.
- The existing frontend agent URL points to `http://host.docker.internal:4098`. The frontend is published on `127.0.0.1:4098`; the scheduler health endpoint is on `127.0.0.1:3300`. These ports must be free.
- The frontend uses `../workspace`, the existing agent instructions, plugins, and OpenCode configuration. Its OpenCode data persists in a factory-specific Docker volume.
- If either link is missing, recreate it with `ln -s ../.env.local .env.local` or `ln -s ../shared-db/db.sqlite db.sqlite` from this folder. Prepare the target files before starting; the apps do not create or migrate the database.

The planned backend factory needs its own database and backend agent configuration as well as its own board settings. Sharing the frontend database across different boards would mix their ticket state.
