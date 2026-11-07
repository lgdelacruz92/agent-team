# Communication

Estimated reading time: 1 minute (150 WPM)

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant V as Vikunja
    participant DB as Scheduler Database
    participant A as Agent Manager

    S->>DB: Acquire ticket-scheduling lock
    alt Lock held by another process
        DB-->>S: Unavailable
        S->>S: Skip this pass and retry later
    else Lock acquired
    DB-->>S: Owner token
    S->>V: Get tickets
    V-->>S: Return tickets

    S->>DB: Atomically sync tickets and board presence
    DB-->>S: Board snapshot saved

    S->>DB: Get present ready tickets without active assignments
    DB-->>S: Return eligible tickets
    S->>S: Choose next ticket

    opt Ticket is Retry
        S->>DB: Count recorded execution requests
        DB-->>S: Attempt count
        opt At or above the limit
            S->>V: Move card to Flagged tickets
            Note over S: End pass without assigning
        end
    end

    opt Ticket is eligible and below the limit
    S->>A: Assign ticket to an available agent

    alt Agent is available
        A->>DB: Create assignment without changing ticket or agent status
        DB-->>A: Assignment saved
        A-->>S: Assignment confirmed
    else No agent is available
        A-->>S: No available agent
        S->>S: Retry later
    end
    end
    S->>DB: Release lock using owner token
    end
```

The lock is also released after pass errors. A failed or uncertain move is retried after a fresh board fetch. The Resource Manager has not implemented its side of the lock protocol yet.
