# Agent resource manager: initial sequence diagram

Estimated reading time: 2 minutes (150 WPM)

**Draft:** This is a proposed flow, not implemented behavior or an approved lifecycle. It will change as we resolve the open questions.

## One assignment

```mermaid
sequenceDiagram
    autonumber
    participant V as Vikunja
    participant S as Ticket Scheduler
    participant DB as Shared SQLite
    participant RM as Resource manager
    participant A as OpenCode agent
    participant H as Human monitor

    loop Every Resource Manager tick for each agent
        RM->>A: Check agent status
        A-->>RM: Observed status or unreachable
        Note over RM: Idle and ready means success for the attempt<br/>Too slow or unreachable means failure
        opt Agent is unreachable
            RM->>DB: Mark agent unavailable and flag for human review
        end
    end

    S->>V: Fetch board tickets
    V-->>S: Tickets and column statuses
    S->>DB: Sync tickets and reserve an eligible assignment
    Note over S,DB: Proposed attempt-limit check applies to Retry tickets
    Note over DB: Incomplete assignment reserves ticket and agent

    RM->>DB: Read incomplete assignment, ticket, and agent
    Note over RM,DB: Proposed: agent URL and execution history<br/>are not in the current schema
    RM->>A: Check for existing work / actual state
    alt Safe to start
        RM->>V: Fetch task by vikunja_task_id
        break Task fetch fails
            V-->>RM: Fetch failure
            Note over RM,DB: Keep reservation and retry later<br/>Do not count an agent attempt
            opt Failure persists
                RM->>H: Alert about the fetch failure
            end
        end
        V-->>RM: Task details, including description
        RM->>A: Request work with the ticket description
        A-->>RM: Startup result
    else Already running or finished
        A-->>RM: Observed work or outcome
    else State or startup is uncertain
        opt Resource Manager decides the attempt failed
            RM->>A: Try to stop the session
            Note over RM,A: Retry can proceed even if stop is unconfirmed<br/>An old session may still be running
            RM->>DB: Record failed attempt
        end
    end

    opt Startup confirmed
        Note over RM,V: Ordering and recovery for reporting<br/>and card movement are undecided
        RM->>DB: Report observed agent and assignment progress
        RM->>V: Move card to In progress
        alt Move fails
            RM->>H: Surface or reconcile the failed move
            Note over RM,A: A failed card move does not mean work stopped
        end
    end

    opt Work is observed running
        RM->>A: Check work state and outcome
        A-->>RM: Observed state or outcome
    end

    opt Work finishes or the Resource Manager decides it failed
        RM->>DB: Record the Resource Manager's outcome
        alt Agent stopped processing and is ready
            RM->>V: Move card to Done
        else Agent is too slow or unreachable
            RM->>V: Move card to Retry
        end
        Note over S,RM: Completion and retry-limit coordination are not designed.<br/>An overlapping scheduler fetch can write stale status.
        alt Safe completion protocol satisfied
            RM->>DB: Complete assignment and report actual agent availability
        else Safety cannot be established
            RM->>H: Surface the issue for investigation
            Note over DB: Keep the assignment reserved
        end
    end

    opt Later Ticket Scheduler pass finds an eligible Retry ticket
        S->>DB: Check recorded attempt count
        Note over S,DB: First attempt counts as 1<br/>execution schema and counting rules undecided
        alt Below attempt limit
            S->>DB: Reserve a new assignment on an available agent
        else Attempt limit reached
            S->>V: Move card to Flagged tickets
            Note over V,H: Human intervention
        end
    end
```

The diagram shows logical interactions, not a promise that every action occurs in one pass. Retries, restarts, and failures may span multiple passes.

## Questions to resolve

- What else belongs in the work payload? When should a persistent task-fetch failure trigger an alert?
- How does the manager identify existing OpenCode sessions and recover after an uncertain start or restart?
- How do we recognize startup and readiness for the correct execution? How do we prevent competing controllers from dispatching work?
- What does an execution record contain, and which statuses and transitions do we want?
- What is the attempt limit, how are attempts identified in execution records, and how should a flagged ticket be handled? How do we prevent further retries at the limit?
- How long is too long, and how is the timeout measured? What happens if no replacement agent is available?
- How should card-move failures and manual card changes be handled?
- How do we enforce one active manager and safely complete assignments despite overlapping scheduler fetches?

See the [proposal](proposal.md), [flowchart](flowchart.md), and [session context](session-context.md) for background. The [Ticket Scheduler change handoff](../../scheduler/docs/retry-limit-handoff.md) describes the agreed responsibility split.
