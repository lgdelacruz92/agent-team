# Agent resource manager: initial sequence diagram

Estimated reading time: 3 minutes (150 WPM)

**Draft:** This is a proposed flow, not implemented behavior or an approved lifecycle. It will change as we resolve the open questions.

## One assignment

```mermaid
sequenceDiagram
    autonumber
    box rgb(30,58,138)
        participant V as Vikunja
        participant S as Ticket Scheduler
        participant DB as Shared SQLite
    end
    participant RM as Resource manager
    box rgb(30,58,138)
        participant A as OpenCode agent
        participant H as Human monitor
    end

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
    Note over S,DB: Attempt-limit check applies to Retry tickets
    Note over DB: Incomplete assignment reserves ticket and agent

    RM->>DB: Read incomplete assignment, ticket, and agent
    Note over RM,DB: Agent URL and execution history<br/>are not in the current schema
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

Dark blue groups are outside the Resource Manager app. The diagram shows logical interactions, not a promise that every action occurs in one pass. Retries, restarts, and failures may span multiple passes.

## Discussed: directions to implement

- Fetch the full Vikunja description before starting work. If the fetch fails, keep the assignment reserved, retry, and alert a human if the failure persists.
- Poll every agent each tick. The Resource Manager decides the outcome: idle and ready means success; too slow or unreachable means failure.
- On failure, try to stop the session, but allow a retry even if the stop cannot be confirmed. Flag unreachable agents for human review and use another available agent.
- The Ticket Scheduler checks the attempt limit and moves exhausted tickets to `Flagged tickets`. The first attempt counts as 1.
- Use a shared database lock to coordinate scheduler passes and assignment completion. Flag potentially stale locks for human review, rather than clearing them automatically.
- Assume humans do not manually move cards. No special Resource Manager behavior for manual moves is needed; the user expects the Ticket Scheduler to flag data inconsistencies appropriately.

## Values and details to work out

- Agent timeout, attempt limit, and when persistent task-fetch failures trigger an alert.
- Stale-lock warning threshold and human recovery steps, explicitly deferred for later.
- Execution-record fields, session identification, startup and restart recovery, and readiness detection for the correct execution.
- Lock protocol and coordination with other controllers, card-move failures, and how humans clear agent or ticket flags.

These are discussed topics, not necessarily new questions for the user. Work through implementation details as we build, and revisit deferred decisions when needed.

## Open: not yet discussed

No undiscussed topics are currently listed.

See the [proposal](proposal.md), [flowchart](flowchart.md), and [session context](session-context.md) for background. The [Ticket Scheduler change handoff](../../scheduler/docs/retry-limit-handoff.md) describes the agreed responsibility split.
