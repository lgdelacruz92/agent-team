# Ticket Scheduler: don't forget

Estimated reading time: 1 minute (150 WPM)

High-priority work to return to:

- [ ] Implement the [retry-limit handoff](retry-limit-handoff.md): check recorded attempts for `Retry` tickets and move exhausted tickets to `Flagged tickets`. The handoff is historical; use [open-discussion.md](open-discussion.md) for newer decisions and remaining details.
- [ ] Work through the Ticket Scheduler and shared-integration items in [missing-features.md](missing-features.md), including the shared database lock and execution data needed to coordinate with the Resource Manager.

These are reminders, not authorization to implement or start live agents. The attempt-limit value remains undecided.
