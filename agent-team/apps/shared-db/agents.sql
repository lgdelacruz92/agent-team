-- Adds the frontend agent. Running this again inserts another row.
INSERT INTO agents (name, status, url)
VALUES ('frontend', 'idle', 'http://host.docker.internal:4098');
