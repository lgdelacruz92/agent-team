# Scheduler session context

Estimated reading time: 2 minutes (150 WPM)

## Purpose

The user is developing `scheduler/` as version 2 of the ticket scheduler. Its goal is to schedule Vikunja tickets to OpenCode agents. The user is unhappy with `frontend-ctr` because its implementation is difficult to follow; the new scheduler should be easier to understand.

## Current state

- `scheduler/` is a standalone TypeScript and Express scaffold with SQLite persistence.
- It has generic state endpoints, domain stores for tickets, agents and assignments, and interfaces for future components.
- Scheduling, worker dispatch and Vikunja integration are not implemented yet. `frontend-ctr` remains separate.

## Intended communication

`docs/architecture.comm.md` diagrams the proposed flow: fetch Vikunja tickets, save them locally, select a ready ticket, ask the Agent Manager to assign it, record the assignment, and move the Vikunja ticket to In progress. If no agent is available, retry later. The user moved this diagram into `docs/` during this session.

## Working agreement

Focus this session on `scheduler/`. After each user prompt, update notes in `scheduler/docs/` with relevant conversation context and where the project stands, in addition to carrying out the requested work. Treat `frontend-ctr` as reference, not a design to copy automatically.

The user requested that all current changes be committed.
