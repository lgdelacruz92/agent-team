import { describe, expect, it } from "vitest"
import { branchName, buildPrompt, buildWrapup, formatMarker, parseMarker, reportBody, reportHeader } from "../src/components/prompt.js"
import { countAttempts, reconcile } from "../src/components/reconcile.js"

const soft = new Date("2026-11-02T10:24:00Z")
const hard = new Date("2026-11-02T10:30:00Z")

describe("prompt", () => {
  it("builds the branch name from id and title", () => {
    expect(branchName(42, "Login form!")).toBe("ticket-42-login-form")
    expect(branchName(7, "***")).toBe("ticket-7")
  })

  it("includes ticket, blocker reports, deadlines, branch and report format", () => {
    const text = buildPrompt({
      id: 42,
      title: "Login form",
      description: "Acceptance criteria: renders",
      blockers: [{ id: 41, title: "API", report: "route /api/login on port 8080" }],
      softDeadline: soft,
      hardDeadline: hard,
      branch: "ticket-42-login-form",
    })
    expect(text).toContain("Ticket #42: Login form")
    expect(text).toContain("route /api/login on port 8080")
    expect(text).toContain("10:24 UTC")
    expect(text).toContain("10:30 UTC")
    expect(text).toContain("ticket-42-login-form")
    expect(text).toContain("Do not claim a test passed unless you ran it.")
  })

  it("wrap-up asks for commit, WIP pull request and report", () => {
    const text = buildWrapup({ branch: "b", hardDeadline: hard })
    expect(text).toContain("WIP:")
    expect(text).toContain("Commit")
  })

  it("round-trips the marker comment", () => {
    const marker = { session: "ses_abc", prompt: "msg_1", branch: "b", softDeadline: soft, hardDeadline: hard }
    expect(parseMarker(formatMarker(marker))).toEqual(marker)
    expect(parseMarker("hello")).toBeNull()
  })

  it("extracts a report body", () => {
    expect(reportBody(`${reportHeader} (run timed out)\n\nfiles: a.ts`)).toBe("files: a.ts")
    expect(reportBody("random comment")).toBeNull()
  })
})

describe("reconcile", () => {
  const marker = formatMarker({ session: "ses_1", prompt: "msg_1", branch: "b", softDeadline: soft, hardDeadline: hard })
  const c = (id: number, comment: string) => ({ id, created: "", comment })

  it("finds the newest run and its wrap-up", () => {
    const run = reconcile([c(1, marker), c(2, "[frontend-ctr] run failed\nx"), c(3, marker.replace("ses_1", "ses_2")), c(4, "[frontend-ctr] wrap-up sent\nprompt: msg_9")])
    expect(run?.marker.session).toBe("ses_2")
    expect(run?.wrapupPrompt).toBe("msg_9")
    expect(run?.since).toBe("msg_9")
  })

  it("returns null without a marker and counts attempts", () => {
    expect(reconcile([c(1, "hi")])).toBeNull()
    expect(countAttempts([c(1, marker), c(2, "[frontend-ctr] run failed\nx"), c(3, marker)])).toEqual({ started: 2, failed: 1 })
  })
})
