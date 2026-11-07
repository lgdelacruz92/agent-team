# Agent resource manager: proposed flow

Estimated reading time: 1 minute (150 WPM)

**This is a proposed direction, not implemented behavior.** See the [proposal](proposal.md) for the build slices, safety boundaries, and open decisions.

## Big picture

```mermaid
flowchart LR
    V["Vikunja board"] -->|"fetch cards"| S["Scheduler<br/>(exists)"]
    S -->|"sync tickets + record assignment"| DB[("Shared SQLite")]
    DB -->|"read incomplete assignments"| RM["Resource manager<br/>(proposed)"]
    RM -->|"start and observe work"| A["Real agent"]
    A -->|"actual state + outcome"| RM
    RM -->|"report agent + assignment state"| DB
    RM -->|"move and check cards"| V
```

SQLite is the shared job board. An assignment reserves work; it does not prove that the agent started.

## One assignment: proposed path

```mermaid
flowchart TD
    Start["Read an incomplete assignment"] --> Check{"Can we establish<br/>what the agent is doing?"}
    Check -->|"unknown"| Human["Keep reservation;<br/>investigate or alert human"]
    Check -->|"already running or finished"| Observe["Observe real agent state"]
    Check -->|"not started; safe to start"| Launch["Request work"]
    Launch --> Confirm{"Startup confirmed?"}
    Confirm -->|"uncertain or failed"| Human
    Confirm -->|"yes"| Report["Report observed progress;<br/>move card to In progress"]
    Report --> Move{"Card move succeeded?"}
    Move -->|"no"| Retry["Surface failure and reconcile move;<br/>do not assume agent stopped"]
    Retry --> Observe
    Move -->|"yes"| Observe
    Observe --> Finished{"Work finished?"}
    Finished -->|"no"| Later["Check again later"]
    Later --> Observe
    Finished -->|"yes"| Coordinate["Coordinate final card and DB state;<br/>confirm agent is available"]
    Coordinate --> Safe{"Completion protocol<br/>satisfied?"}
    Safe -->|"no or unknown"| Human
    Safe -->|"yes"| Complete["Record completion;<br/>report actual agent state"]
```

**Important:** The completion protocol is not designed yet. A stale scheduler fetch can overwrite a newer card status, so a successful move alone does not make release safe. Startup and card-move ordering are also undecided.

## Build path

```mermaid
flowchart LR
    A1["A1: Understand<br/>real agents"] --> D1["D1: Agree on lifecycle<br/>and recovery"]
    D1 --> D2["D2: Agree on DB<br/>and board coordination"]
    D2 --> A2["A2: One testable<br/>reconciliation pass"]
    A2 --> A3["A3: Agent + Vikunja<br/>integrations"]
    A3 --> A4["A4: Safe completion<br/>and operation"]
```

Each box is a proposed milestone, not a commitment to implement it now.
