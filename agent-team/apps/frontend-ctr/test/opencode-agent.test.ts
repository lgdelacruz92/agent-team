import { afterEach, describe, expect, it, vi } from "vitest"
import { OpencodeAgent } from "../src/services/opencode-agent.js"

vi.mock("../src/config.js", () => ({
  config: {
    opencodeUrl: "http://opencode.test",
    opencodeUser: "opencode",
    opencodePassword: "secret",
    opencodeTimeoutMs: 1000,
  },
}))

// Replaces fetch with a stub that answers once with the given status and body.
const stubFetch = (status: number, body: unknown) => {
  const fetchMock = vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })

  vi.stubGlobal("fetch", fetchMock)

  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// A session record as GET /api/session returns it, with only the times that state() reads.
const session = (time: { busy?: number; idle?: number }) => ({ id: "ses_1", time: { created: 1, ...time } })

describe("OpencodeAgent.state", () => {
  it("is idle when there are no sessions", async () => {
    stubFetch(200, { data: [] })

    expect(await new OpencodeAgent("frontend").state()).toBe("idle")
  })

  it("is idle when a session has never been busy", async () => {
    stubFetch(200, { data: [session({})] })

    expect(await new OpencodeAgent("frontend").state()).toBe("idle")
  })

  it("is idle when every session went idle after it was busy", async () => {
    stubFetch(200, { data: [session({ busy: 10, idle: 20 })] })

    expect(await new OpencodeAgent("frontend").state()).toBe("idle")
  })

  it("is busy when a session went busy and has no idle time", async () => {
    stubFetch(200, { data: [session({ busy: 10 })] })

    expect(await new OpencodeAgent("frontend").state()).toBe("busy")
  })

  it("is busy when a session went busy after it was last idle", async () => {
    stubFetch(200, { data: [session({ busy: 30, idle: 20 }), session({ busy: 10, idle: 20 })] })

    expect(await new OpencodeAgent("frontend").state()).toBe("busy")
  })

  it("is unreachable when the server answers with an error", async () => {
    stubFetch(500, {})

    expect(await new OpencodeAgent("frontend").state()).toBe("unreachable")
  })

  it("is unreachable when the answer is not JSON, such as the web UI's HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token <")
        },
      }),
    )

    expect(await new OpencodeAgent("frontend").state()).toBe("unreachable")
  })

  it("is unreachable when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("connection refused")))

    expect(await new OpencodeAgent("frontend").state()).toBe("unreachable")
  })

  it("calls the session list endpoint with basic auth", async () => {
    const fetchMock = stubFetch(200, { data: [] })

    await new OpencodeAgent("frontend").state()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://opencode.test/api/session")
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("opencode:secret").toString("base64")}`)
  })

  it("uses the base url it was given instead of the configured one", async () => {
    const fetchMock = stubFetch(200, { data: [] })

    await new OpencodeAgent("frontend", "http://other.test").state()

    expect(fetchMock.mock.calls[0][0]).toBe("http://other.test/api/session")
  })
})
