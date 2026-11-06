# Scheduler v2 scaffold

Estimated reading time: 1 minute (150 WPM)

Standalone TypeScript Express app with SQLite persistence. No scheduling, worker dispatch, or Vikunja integration yet. The existing `frontend-ctr` stays separate.

## Run

Requires Node.js 22.13+ for built-in `node:sqlite` (experimental on some Node versions).

From `apps/scheduler`:

```sh
npm install
npm run dev
```

Defaults to `http://127.0.0.1:3300`. No authentication: keep it local.

## Configuration

- `HOST`: default `127.0.0.1`.
- `PORT`: default `3300`.
- `SCHEDULER_DB_PATH`: default `data/scheduler.sqlite`, relative to the working directory.

The database directory and table are created automatically. Database files are git-ignored. Keep the same database path to retain state across restarts.

## Endpoints

- `GET /health`: liveness check.
- `PUT /state/:key`: save JSON using a body containing `value`.
- `GET /state/:key`: retrieve saved JSON; missing keys return 404.

```sh
curl -X PUT http://127.0.0.1:3300/state/example \
  -H 'Content-Type: application/json' \
  -d '{"value":{"paused":true}}'
curl http://127.0.0.1:3300/state/example
```

## Checks

```sh
npm test
npm run typecheck
npm run build
npm start
```

SQLite currently holds generic key/value state. Ticket and worker models can come later.
