# Agent resource manager

Estimated reading time: 1 minute (150 WPM)

This app will watch Ticket Scheduler assignments and reconcile real agent resources. Its initial process loop runs, but it does not load a Resource Manager or perform any work yet.

## Run

```sh
npm install
npm run dev
```

The loop logs that it is idle every 30 seconds. Stop it with Ctrl+C. To run the compiled app, use `npm run build` followed by `npm start`.

For the shared database prerequisite, see [setup](docs/setup.md).

**Start here:** read the [scheduler handoff](../scheduler/docs/agent-resource-manager.md) for the agreed responsibilities, current database behavior, example lifecycle, and decisions still open. Then check the linked scheduler source before designing an integration.

The handoff is context for future work, not authorization to start agents, modify infrastructure, or implement the app without a request.

For session decisions and current progress, read [session context](docs/session-context.md).

For the initial direction, see the [proposed flowchart](docs/flowchart.md) and [build proposal](docs/proposal.md).
