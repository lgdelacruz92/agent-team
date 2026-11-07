# Ticket Scheduler: don't forget

Estimated reading time: 1 minute (150 WPM)

High-priority work to return to:

- [ ] Implement the [retry-limit handoff](retry-limit-handoff.md): check recorded attempts for `Retry` tickets and move exhausted tickets to `Flagged tickets`. The handoff is historical; use [open-discussion.md](open-discussion.md) for newer decisions and remaining details.
- [ ] Work through the Ticket Scheduler and shared-integration items in [missing-features.md](missing-features.md), including the shared database lock and execution data needed to coordinate with the Resource Manager.

The attempt limit defaults to 3 and can be configured with `SCHEDULER_MAX_ATTEMPTS`, but it is not enforced yet. These reminders do not authorize starting live agents.
