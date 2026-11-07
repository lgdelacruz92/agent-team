# Agent resource manager session context

Estimated reading time: 6 minutes (150 WPM)

## Working agreement

- After each user prompt, update these notes with relevant context, decisions, and project status alongside the requested work.
- Favor understandable code over development speed; keep the system practical for common cases with a human monitoring it.

## Where we left off

- The session is ending while discussing A1: understanding the real agents, before deciding when to implement.
- The last unanswered question for the user: **Should the manager fetch the full ticket description from Vikunja and send it to the agent?** The scheduler's ticket table currently stores the title but not the description.
- Remaining A1 topics: identify and recover OpenCode sessions after uncertain starts or restarts; determine evidence of success, failure, and availability; and prevent another controller from dispatching to the same worker concurrently. Inspect the real OpenCode API and existing frontend controller rather than assuming their behavior.
- Next, agree on the lifecycle (D1) and scheduler/board completion coordination (D2). Small isolated implementation slices can start earlier, but automatic dispatch and release require the unresolved safety decisions. No real agents or infrastructure were started or changed in this session.
- Decisions so far: keep numeric `agents.id` and add a URL field for the containerized OpenCode server; user favors an `executions` table for debugging; manager reports assignment outcomes and actual agent state; successful work goes to Vikunja `Done`. The user will redo conflicting agent instructions later. A failed ticket moving to `Retry` was discussed as a direction, not a finalized completion protocol.

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
- User plans to work on implementing the resource manager in this session and asked to read the folder, paying close attention to its docs. Reviewed all manager docs, the scheduler handoff and README, and the linked scheduler implementation and schema. No implementation changes requested yet.
- User wants to discuss A1, understanding real agents. Repository inspection shows Docker Compose defines OpenCode worker servers for frontend, backend, and AWS architecture; `frontend-ctr` contains an example client that creates sessions, prompts them, checks server/session state, and reads messages. This is existing code, not proof of the intended manager integration or verified runtime behavior.
- A1 questions: how integer `agents.id` identifies or resolves to an actual worker endpoint; how an assignment maps durably to an OpenCode session, including uncertain starts; what evidence establishes completion; and how to avoid competing with an existing controller. The scheduler ticket table lacks the description used by the existing frontend controller's prompt. No A1 design decisions made yet.
- A1: User confirmed agents are OpenCode servers running in containers, each uniquely identified by its URL. Keep numeric `agents.id` and add a URL field mapping the ID to the server. Migration and provisioning details remain open.
- User favors an `executions` table in the shared database to preserve session and attempt history for debugging. Exact fields, lifecycle, retry rules, and recovery for uncertain starts remain open.
- User asked whether the existing scheduler handles retries and suggested the manager move failed tickets to Vikunja `Retry`. Scheduler selects `Retry` tickets only when they have no incomplete assignment; safe assignment completion and coordination with overlapping board fetches remain unresolved. A `Retry` move alone does not create a new attempt or release the reservation.
- Clarified scheduler visibility: it records assignments and reads stored reservation/availability fields but does not observe agents or independently determine execution success or failure. Assignment status text alone does not control release; `completed_at` does.
- User proposed one idea: the manager updates assignment status to in progress, failed, or succeeded and updates agent status accordingly. This fits the intended ownership; exact status names and safe completion/availability rules remain open. Discussed keeping outcome separate from `completed_at` so an outcome can be recorded while the reservation remains in place.
- User chose Vikunja `Done` as the destination after a successful run. Existing frontend agent instructions conflict by specifying `Review`; user said to ignore that for this work and will redo agent instructions later. Success evidence and safe completion coordination remain open.
- User asked whether A1 is complete and implementation can start. Agent URL identity is decided; payload source, OpenCode start/observation and restart recovery, success/failure evidence, and concurrent-controller ownership still need investigation or decisions. D1 lifecycle and D2 scheduler/board coordination also remain open. Safe, isolated implementation slices may begin before automatic dispatch and release are authorized.
