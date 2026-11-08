-- DESTRUCTIVE: permanently removes all five shared tables and their data.
-- Stop both apps and back up the database before running this script.
-- Run with sqlite3 -bail so any error stops the script and rolls back the transaction.

PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

DROP TABLE IF EXISTS executions;
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS locks;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS agents;

COMMIT;
