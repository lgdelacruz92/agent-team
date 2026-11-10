# Session Context

Estimated reading time: 2 minutes (150 WPM)

## 2026-11-10

- Initialized project notes in `agent-team/apps/agents/docs/`. No substantive task requested yet.
- Started `coding-standards.md` as an evolving document describing how workers should write code. Waiting for the user's preferences before adding standards.
- Reviewed the scheduler's source, interfaces, tests, configuration, and documentation as a code-quality model. Wrote a first set of inferred standards in `coding-standards.md`, with links to examples; ready for the user's review and iteration.
- Added instructions for the backend and frontend workers to read and follow the shared coding standards from their mounted team directory. Preserved the frontend's existing React-specific standards.
- Answered how to connect an OpenCode V2 terminal client to the running frontend server, using the port in the Compose configuration. The existing `frontend-tty.sh` opens a container shell instead.
- Updated `frontend.md` to require a safe, fast-forward-only update of `local-markets-app` main, an app-wide coding-standards review and refactor, and checks before each task; reconciled conflicting instructions about unrelated code.
- Added the same pre-task repository update and coding-standards review and refactor process to `backend.md`.
