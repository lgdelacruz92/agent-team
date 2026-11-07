# Resource Manager: don't forget

Estimated reading time: 1 minute (150 WPM)

High-priority work to return to:

- [ ] Continue the [data and coordination design](data.md), including the remaining session-recovery and shared-lock implementation details.
- [ ] Resume the paused Resource Manager `runOnce()` implementation and its integration contracts. The current process loop is idle; it does not manage agents yet.
- [ ] Implement the Resource Manager and shared-integration items in the Ticket Scheduler's [missing-features.md](../../scheduler/docs/missing-features.md), including execution/session tracking and coordinated assignment completion.

These are reminders, not authorization to implement or start live agents. Follow the agreed decisions and deferred details in the linked documents.
