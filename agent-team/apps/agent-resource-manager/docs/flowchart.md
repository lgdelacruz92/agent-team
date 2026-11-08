# Agent resource manager: proposed flow

Estimated reading time: 2 minutes (150 WPM)

The core Ticket Scheduler and Resource Manager paths below are implemented and tested with controlled dependencies. Deployed APIs and some readiness behavior still need verification. See the [data design](data.md) for recovery and coordination details.

## Big picture

```mermaid
flowchart LR
    V["Vikunja board"] -->|"fetch cards"| S["Ticket Scheduler<br/>(implemented)"]
    S -->|"sync tickets and reserve assignments"| DB[("Shared SQLite")]
    S -->|"flag exhausted retries"| V
    DB -->|"read reservations"| RM["Resource Manager"]
    RM -->|"record executions and state"| DB
    RM -->|"fetch descriptions and move cards"| V
    RM -->|"start and observe sessions"| A["OpenCode agent"]
    A -->|"observed state"| RM
    classDef external fill:#dbeafe,stroke:#1d4ed8,color:#111827
    class V,S,DB,A external
```

Blue boxes are outside the Resource Manager app.

SQLite is the shared job board. An incomplete assignment reserves its ticket and agent; it does not prove work started. Both apps use the same `ticket-scheduling` lock for coordinated completion.

## One assignment: proposed path

```mermaid
flowchart TD
    Start["Read incomplete assignment"] --> Check{"Existing execution?"}
    Check -->|"yes"| Recover["Reconcile saved session and request state"]
    Check -->|"no"| Fetch["Fetch full Vikunja task"]
    Fetch --> FetchOK{"Fetch succeeded?"}
    FetchOK -->|"no"| FetchRetry["Keep reservation and retry;<br/>log each failure to the terminal"]
    FetchOK -->|"yes"| Create["Create starting execution;<br/>create session and save session ID"]
    Create --> Send["Log intent, send work, then record work_requested_at"]
    Send --> Observe["Observe session and agent"]
    Recover --> Observe
    Observe --> State{"Outcome?"}
    State -->|"still working"| Later["Check on a later tick"]
    Later --> Observe
    State -->|"idle and ready"| Success["Record succeeded; target Done"]
    State -->|"too slow or unreachable"| Fail["Record failed and try to stop session;<br/>target Retry"]
    Success --> Lock{"Acquire shared lock?"}
    Fail --> Lock
    Lock -->|"held"| Wait["Keep reservation; retry later"]
    Lock -->|"acquired"| Move{"Final card move confirmed?"}
    Move -->|"no or uncertain"| WaitRelease["Keep reservation; release lock;<br/>retry move later"]
    Move -->|"yes"| Complete{"Complete assignment"}
    Complete -->|"failed or uncertain"| DBRetry["Leave card in place; release lock;<br/>inspect if uncertain and retry under lock"]
    Complete -->|"confirmed"| Release["Release lock; reservation ends"]
```

The manager polls every agent each tick. A failed task fetch does not count as an agent attempt. The manager flags unreachable agents unavailable for human review. When it observes a session busy, it records progress and moves the card to `In progress`; failed moves are retried while the session remains busy. A failed attempt can be retried even if stopping the old session cannot be confirmed. The Ticket Scheduler checks recorded attempts on `Retry` tickets and flags exhausted work instead of assigning it.

The shared lock covers the final move and assignment completion. Both apps must use it and Vikunja reads must reflect confirmed moves. Potentially stale locks require human review, not automatic removal. See the [data design](data.md) for the agreed restart cases and failure handling.

## Build path

```mermaid
flowchart LR
    Design["Continue data and<br/>coordination details"] --> Contracts["Extend integration contracts<br/>for executions and lock"]
    Contracts --> Pass["Implement and test<br/>reconciliation pass"]
    Pass --> Integrations["Implement database, agent,<br/>and Vikunja integrations"]
    Integrations --> Verify["Test recovery and completion<br/>with controlled dependencies"]
    Verify --> Joint["Test both apps together<br/>before real dispatch"]
```

These describe the build path; controlled tests now cover the core integration. The shared tables need external setup; the [shared seed](../../shared-db/seed.sql) creates them for a new database, but a human must populate and validate agent rows. Do not start live agents without authorization.
