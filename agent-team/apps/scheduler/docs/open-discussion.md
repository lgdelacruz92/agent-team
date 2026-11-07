# Retry limit: open discussion

Estimated reading time: 2 minutes (150 WPM)

Discuss these decisions one at a time before implementing the complete [retry-limit handoff](retry-limit-handoff.md). No decisions below have been made yet.

1. **Limit:** How many total attempts? The first attempt counts as 1.
2. **Counting:** What creates an execution record, and which records count—especially uncertain starts? The shared `executions` table doesn’t exist yet.
3. **Human intervention:** After a ticket is flagged, how can a human allow it to be attempted again? Reset the count, or use another mechanism?
4. **Failures:** If the count is unavailable or the card move fails, how should the scheduler report and retry it? It must not assign another attempt when the limit may have been reached.
5. **Coordination:** How do the Resource Manager and Ticket Scheduler prevent stale board data from causing another assignment? Their completion protocol is still open.

Start with decision 1: how many total attempts should a ticket get before it moves to `Flagged tickets`?
