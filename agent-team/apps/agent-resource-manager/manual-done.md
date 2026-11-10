# Manually release a worker after its PR merges

Estimated reading time: 5 minutes (150 WPM)

Use this proof-of-concept procedure after confirming the worker's PR was merged into `main`. It moves the ticket to Done, completes its assignment, and makes the worker eligible for another assignment. It does not implement automatic PR tracking.

## Important limitation

The current Resource Manager can treat an idle session as successful **before** the PR merges. To use this policy, stop the manager before it can process the idle session and leave it stopped while the PR awaits review. This procedure cannot undo an assignment the manager already released. If it was already completed, stop and investigate rather than repeating these steps.

The scheduler considers a worker available only when `agents.status` is exactly `idle` **and** the worker has no assignment with `completed_at` empty. Changing the status alone is not enough.

## 1. Pause and verify

1. Stop the Resource Manager, the Ticket Scheduler, and any other controllers using this board or database. Wait for their current passes to finish. Do not stop the OpenCode worker if it is needed for review; confirm it is no longer running work before releasing it.
2. Confirm the PR was merged into `main`, and identify its Vikunja ticket and worker. Confirm you are looking at the correct board and database. Both apps must use the same database: the defaults point to `apps/shared-db/db.sqlite`, but `SCHEDULER_DB_PATH`, `RESOURCE_MANAGER_DB_PATH`, and container mounts can select different files. Use the actual host path for the database used by these services, not a different factory's copy.
3. If a controller could still be running, the worker is not ready, or the database is uncertain, stop here.

## 2. Find the exact records

In a terminal, set `DB` to the verified **existing** database file and `BACKUP` to a new backup file in an existing directory. Use paths without single quotes. This uses SQLite's backup operation, which includes committed WAL data; do not copy only the main database file. If either check or the backup fails, stop.

```sh
DB='/absolute/path/to/the/actual/shared.sqlite'
BACKUP='/absolute/path/to/a/new-backup.sqlite'
if [ -f "$DB" ] && [ ! -e "$BACKUP" ]; then
  sqlite3 -readonly "$DB" ".backup '$BACKUP'"
else
  echo 'Database missing or backup already exists; stop.'
fi
```

Confirm the backup succeeded and the file exists. Then open the existing database:

```sh
if [ -f "$DB" ]; then sqlite3 "$DB"; else echo 'Database not found; stop.'; fi
```

In the SQLite prompt, run:

```sql
.headers on
.mode column
PRAGMA database_list;
SELECT id, name, status, url FROM agents ORDER BY id;
SELECT a.id AS assignment_id, a.agent_id, a.ticket_id,
       t.vikunja_task_id, t.title, a.status, a.completed_at
FROM assignments AS a
JOIN tickets AS t ON t.id = a.ticket_id
WHERE a.completed_at IS NULL
ORDER BY a.agent_id, a.id;
SELECT name, owner, acquired_at FROM locks;
```

Check the displayed database path, agent name, Vikunja task ID, and title. Find the one incomplete assignment for this worker and ticket. If there are other incomplete assignments for that worker, a missing record, or a lock row, stop and investigate. Do not delete locks as part of this procedure.

Set these three parameters to the **numeric IDs you just verified**; replace the example values. The execution ID is found in the next query.

```sql
.parameter init
.parameter set @agent_id 1
.parameter set @assignment_id 1
SELECT id, assignment_id, session_id, status, work_requested_at,
       started_at, finished_at, failure_reason
FROM executions
WHERE assignment_id = @assignment_id
ORDER BY id DESC;
```

Identify the latest execution: the first row, with the highest ID. Confirm it belongs to the merged work and its status is `starting`, `running`, or `succeeded`. If there is no execution, its status is `failed`, or the history is unclear, stop and investigate; do not rewrite a failed attempt as successful. Set its numeric ID:

```sql
.parameter set @execution_id 1
```

## 3. Complete the records together

Move the ticket to the exact **Done** column on the correct Vikunja board and confirm it is there. Do this before releasing the assignment, so the scheduler cannot pick up the old card position. If the board move fails or is uncertain, stop without changing the database.

Run the following statements in the same SQLite session. `RETURNING` shows the changed rows. If any statement errors or a required row is missing, run `ROLLBACK;` and investigate. Do **not** run `COMMIT` until the checks below pass.

```sql
BEGIN IMMEDIATE;

-- A previously succeeded execution is left unchanged.
UPDATE executions
SET status = 'succeeded',
    finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    failure_reason = NULL
WHERE id = @execution_id
  AND assignment_id = @assignment_id
  AND status IN ('starting', 'running')
RETURNING id, status, finished_at;

UPDATE assignments
SET status = 'succeeded',
    completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = @assignment_id
  AND agent_id = @agent_id
  AND completed_at IS NULL
RETURNING id, agent_id, status, completed_at;

UPDATE agents
SET status = 'idle'
WHERE id = @agent_id
  AND NOT EXISTS (
    SELECT 1 FROM assignments
    WHERE agent_id = @agent_id AND completed_at IS NULL
  )
RETURNING id, name, status;
```

The execution update returns one row if it was `starting` or `running`, and no row if it was already `succeeded`. The assignment and agent updates must each return **exactly one** matching row. Verify the resulting state before committing:

```sql
SELECT id, assignment_id, status, finished_at FROM executions WHERE id = @execution_id;
SELECT id, agent_id, status, completed_at FROM assignments WHERE id = @assignment_id;
SELECT id, name, status FROM agents WHERE id = @agent_id;
SELECT id FROM assignments WHERE agent_id = @agent_id AND completed_at IS NULL;
```

Confirm: the execution is `succeeded`; the assignment is `succeeded` with a completion timestamp; the right agent is `idle`; and the last query returns no rows. If anything is wrong, run `ROLLBACK;`. Otherwise:

```sql
COMMIT;
.quit
```

The worker is now **eligible**, not guaranteed to be selected: the scheduler also needs an eligible ticket and may choose a different idle worker. When authorized to resume services, the scheduler will refresh its local ticket status from the board. Remember that the current manager still does not enforce the merge-before-idle policy for future assignments.
