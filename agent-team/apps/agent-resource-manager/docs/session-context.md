# Agent resource manager session context

Estimated reading time: 2 minutes (150 WPM)

## Working agreement

- After each user prompt, update these notes with relevant context, decisions, and project status alongside the requested work.
- Favor understandable code over development speed; keep the system practical for common cases with a human monitoring it.

## Current state

- The app has not been implemented. No agent startup or infrastructure changes have been requested.
- Read the [scheduler handoff](../../scheduler/docs/agent-resource-manager.md) for agreed boundaries, current behavior, and open design questions. Check the linked source before designing an integration.
- The scheduler records assignments in shared SQLite. An incomplete assignment reserves its ticket and agent; it does not prove work has started.
- The intended manager will reconcile real agent state, report progress, and move Vikunja cards. Lifecycle, recovery, and completion coordination remain undecided.

## Session context

- Reviewed the app README, scheduler handoff, scheduler README, scheduling and assignment components, and database schema.
- User requested per-prompt notes so they and another agent can resume work later.
- User approved and requested a commit of the initial notes and README link.
- User requested an initial build proposal and a visual flowchart in `docs/`. See [proposal](proposal.md) and [flowchart](flowchart.md); both are preliminary, not approval to implement.
- User requested committing the proposal, flowchart, and related documentation updates.
