-- Adds the frontend agent. Running this again inserts another row.
INSERT INTO agents (name, status, url)
VALUES ('frontend', 'idle', 'http://localhost:4098');
