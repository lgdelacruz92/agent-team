# Scheduler session context

Estimated reading time: 3 minutes (150 WPM)

## Purpose

The user is developing `scheduler/` as version 2 of the ticket scheduler. Its goal is to schedule Vikunja tickets to OpenCode agents. The user is unhappy with `frontend-ctr` because its implementation is difficult to follow; the new scheduler should be easier to understand.

The user also hopes the scheduling system can serve as a blueprint for many applications. The project goal is recorded in `docs/project.md`.

## Current state

- `scheduler/` is a standalone TypeScript and Express scaffold with SQLite persistence.
- It has generic state endpoints, domain stores for tickets, agents and assignments, and interfaces for future components.
- Scheduling, worker dispatch and Vikunja integration are not implemented yet. `frontend-ctr` remains separate.
- The user is ready to begin implementing the components defined by the interfaces. The existing SQLite stores and HTTP scaffold are implemented, but the scheduler workflow and its integrations are not.
- The user prefers to start with the scheduler database, thinking about the data before the scheduling workflow.
- The first implemented method is `SchedulerDatabaseInterface.getReadyTickets`. The user initially deferred `VikunjaInterface`, then asked to implement Vikunja tickets next.
- The initial ready-ticket lookup selects local tickets whose status is exactly `Ready`, in local ID order. Dependency and priority rules are not implemented; this is a starting assumption, not a settled scheduling policy.
- Before implementing the Vikunja ticket fetch, clarify whether it should read one project's Kanban view or support multiple projects. `frontend-ctr` uses one project and view; that is reference, not necessarily the v2 requirement.

## Intended communication

`docs/architecture.comm.md` diagrams the proposed flow: fetch Vikunja tickets, save them locally, select a ready ticket, ask the Agent Manager to assign it, record the assignment, and move the Vikunja ticket to In progress. If no agent is available, retry later. The user moved this diagram into `docs/` during this session.

## Working agreement

Focus this session on `scheduler/`. After each user prompt, update notes in `scheduler/docs/` with relevant conversation context and where the project stands, in addition to carrying out the requested work. Treat `frontend-ctr` as reference, not a design to copy automatically.

The user values code they can understand over development speed or efficiency. Favor clarity and learn their coding preferences from their feedback throughout the process.

Put implementation classes in `src/components/` for now; the user may rename the folder later.

The user requested that all current changes be committed.
The user then added the project goal and requested another commit.
