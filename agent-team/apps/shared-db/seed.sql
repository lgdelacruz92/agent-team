-- Fresh shared SQLite database for the Ticket Scheduler and Resource Manager.
-- Run with sqlite3 -bail so any error stops the script and rolls back the transaction.
-- This is not a migration. It fails if any of these tables already exist.
-- SQLite 3.37 or newer is required for STRICT tables.

PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  vikunja_task_id INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL,
  present_on_board INTEGER NOT NULL DEFAULT 0 CHECK (present_on_board IN (0, 1))
) STRICT;

CREATE TABLE agents (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  url TEXT
) STRICT;

CREATE TABLE assignments (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  agent_id INTEGER NOT NULL REFERENCES agents(id),
  status TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE INDEX assignments_ticket_id ON assignments(ticket_id);
CREATE INDEX assignments_agent_id ON assignments(agent_id);

CREATE TABLE executions (
  id INTEGER PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id),
  session_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  work_requested_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  failure_reason TEXT
) STRICT;

CREATE TABLE locks (
  name TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  acquired_at TEXT NOT NULL
) STRICT;

-- Add actual agents before starting either app. The URL must be reachable from
-- the Resource Manager, and idle means eligible for Ticket Scheduler work.
-- Example only; replace the name and URL after verifying the server:
-- INSERT INTO agents (name, status, url) VALUES ('frontend', 'idle', 'http://example:4096');

COMMIT;
