// Configuration for the frontend controller.
// This is the only worker-specific module: a sibling controller (backend, aws-solutions-architect) copies this file.

// Reads a numeric environment value, falling back to the default when it is missing or not a number.
const readNumber = (raw: string | undefined, fallback: number): number => {
  if (!raw) {
    return fallback
  }

  const value = Number(raw)
  if (Number.isFinite(value)) {
    return value
  }

  return fallback
}

// Removes a trailing slash so paths can be appended safely.
const trimSlash = (url: string): string => url.replace(/\/$/, "")

// ---- Environment variables: every input of the controller, in one place ----

// HTTP server
const _port = readNumber(process.env.PORT, 3000)
const _host = process.env.HOST ?? "0.0.0.0"

// Vikunja
const _vikunjaUrl = trimSlash(process.env.VIKUNJA_URL ?? "http://host.docker.internal:3456")
const _vikunjaToken = process.env.VIKUNJA_API_TOKEN ?? ""
const _vikunjaTimeoutMs = readNumber(process.env.VIKUNJA_TIMEOUT_MS, 30_000)
const _projectId = readNumber(process.env.CTR_PROJECT_ID, 0)
const _viewId = readNumber(process.env.CTR_VIEW_ID, 12)
const _perPage = readNumber(process.env.CTR_PER_PAGE, 200)

// Frontend worker (opencode server)
const _opencodeUrl = trimSlash(process.env.FRONTEND_URL ?? "http://opencode-frontend:4096")
const _opencodeUser = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
const _opencodePassword = process.env.OPENCODE_SERVER_PASSWORD ?? ""
const _opencodeTimeoutMs = readNumber(process.env.CTR_OPENCODE_TIMEOUT_MS, 30_000)

// Scheduling and deadlines
const _pollMs = readNumber(process.env.CTR_POLL_MS, 30_000)
const _defaultBudgetMin = readNumber(process.env.CTR_DEFAULT_BUDGET_MIN, 30)
const _maxRunMin = readNumber(process.env.CTR_MAX_RUN_MIN, 60)
const _graceMin = readNumber(process.env.CTR_GRACE_MIN, 5)
const _maxFailures = readNumber(process.env.CTR_MAX_FAILURES, 3)
const _dryRun = process.env.CTR_DRY_RUN === "true"

// GitHub (optional): lets the controller look for a pull request on the branch after a hard deadline
const _githubRepo = process.env.CTR_GITHUB_REPO ?? ""
const _githubToken = process.env.GITHUB_TOKEN ?? ""

// ---- Config built from the values above ----

export const config = {
  worker: "frontend",

  // Prefix of every comment the controller writes; also how it finds its own comments.
  marker: "[frontend-ctr]",

  port: _port,
  host: _host,

  vikunjaUrl: _vikunjaUrl,
  vikunjaToken: _vikunjaToken,
  vikunjaTimeoutMs: _vikunjaTimeoutMs,
  projectId: _projectId,

  // The controller is bound to a single kanban view of the project (CTR_VIEW_ID, default 12).
  viewId: _viewId,

  // Maximum tasks Vikunja returns per request (CTR_PER_PAGE, default 200), so a column is not cut at the default page size.
  perPage: _perPage,

  opencodeUrl: _opencodeUrl,
  opencodeUser: _opencodeUser,
  opencodePassword: _opencodePassword,
  opencodeTimeoutMs: _opencodeTimeoutMs,

  pollMs: _pollMs,
  defaultBudgetMin: _defaultBudgetMin,
  maxRunMin: _maxRunMin,
  graceMin: _graceMin,
  maxFailures: _maxFailures,
  dryRun: _dryRun,

  githubRepo: _githubRepo,
  githubToken: _githubToken,

  // Kanban bucket titles, compared case-insensitively.
  buckets: {
    ready: "Ready",
    inProgress: "In progress",
    review: "Review",
    retry: "Retry",
    done: "Done",
  },
} as const
