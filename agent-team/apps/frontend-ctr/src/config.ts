// The only worker-specific module. A sibling controller (backend, aws-solutions-architect) copies this file.

const num = (name: string, fallback: number) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && process.env[name] ? value : fallback
}

export const config = {
  worker: "frontend",
  // Prefix of every comment the controller writes; also how it finds its own comments.
  marker: "[frontend-ctr]",
  port: num("PORT", 3000),
  host: process.env.HOST ?? "0.0.0.0",

  vikunjaUrl: (process.env.VIKUNJA_URL ?? "http://host.docker.internal:3456").replace(/\/$/, ""),
  vikunjaToken: process.env.VIKUNJA_API_TOKEN ?? "",
  vikunjaTimeoutMs: num("VIKUNJA_TIMEOUT_MS", 30_000),
  projectId: num("CTR_PROJECT_ID", 0),

  opencodeUrl: (process.env.FRONTEND_URL ?? "http://opencode-frontend:4096").replace(/\/$/, ""),
  opencodeUser: process.env.OPENCODE_SERVER_USERNAME ?? "opencode",
  opencodePassword: process.env.OPENCODE_SERVER_PASSWORD ?? "",
  opencodeTimeoutMs: num("CTR_OPENCODE_TIMEOUT_MS", 30_000),

  pollMs: num("CTR_POLL_MS", 30_000),
  defaultBudgetMin: num("CTR_DEFAULT_BUDGET_MIN", 30),
  maxRunMin: num("CTR_MAX_RUN_MIN", 60),
  graceMin: num("CTR_GRACE_MIN", 5),
  maxFailures: num("CTR_MAX_FAILURES", 3),
  dryRun: process.env.CTR_DRY_RUN === "true",

  // Optional: lets the controller look for a pull request on the branch after a hard deadline.
  githubRepo: process.env.CTR_GITHUB_REPO ?? "",
  githubToken: process.env.GITHUB_TOKEN ?? "",

  // Kanban bucket titles, compared case-insensitively.
  buckets: {
    ready: "Ready",
    inProgress: "In progress",
    review: "Review",
    retry: "Retry",
    done: "Done",
  },
} as const

export type Config = typeof config
