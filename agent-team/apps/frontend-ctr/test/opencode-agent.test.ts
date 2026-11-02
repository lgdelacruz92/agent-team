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

describe("OpencodeAgent.clearSessions", () => {
  // Replaces fetch with a stub that answers each call with the next reply, in order.
  const stubReplies = (...replies: { status: number; body?: unknown }[]) => {
    const fetchMock = vi.fn()

    for (const reply of replies) {
      fetchMock.mockResolvedValueOnce({
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => reply.body,
      })
    }

    vi.stubGlobal("fetch", fetchMock)

    return fetchMock
  }

  const page = (...ids: string[]) => ({ status: 200, body: { data: ids.map((id) => ({ id })) } })

  it("does nothing when there are no sessions", async () => {
    const fetchMock = stubReplies(page())

    await new OpencodeAgent("frontend").clearSessions()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("deletes every session on the page, then lists again to confirm none are left", async () => {
    const fetchMock = stubReplies(page("ses_1", "ses_2"), { status: 200 }, { status: 200 }, page())

    await new OpencodeAgent("frontend").clearSessions()

    const calls = fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)
    expect(calls).toEqual([
      "GET http://opencode.test/api/session",
      "DELETE http://opencode.test/api/session/ses_1",
      "DELETE http://opencode.test/api/session/ses_2",
      "GET http://opencode.test/api/session",
    ])
  })

  it("keeps going through further pages until the list is empty", async () => {
    const fetchMock = stubReplies(page("ses_1"), { status: 200 }, page("ses_2"), { status: 200 }, page())

    await new OpencodeAgent("frontend").clearSessions()

    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it("sends basic auth on every request", async () => {
    const fetchMock = stubReplies(page("ses_1"), { status: 200 }, page())

    await new OpencodeAgent("frontend").clearSessions()

    const expected = `Basic ${Buffer.from("opencode:secret").toString("base64")}`
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers.Authorization).toBe(expected)
    }
  })

  it("treats a session that is already gone as deleted", async () => {
    stubReplies(page("ses_1"), { status: 404 }, page())

    await expect(new OpencodeAgent("frontend").clearSessions()).resolves.toBeUndefined()
  })

  it("throws when a delete fails, instead of looping forever", async () => {
    stubReplies(page("ses_1"), { status: 500 })

    await expect(new OpencodeAgent("frontend").clearSessions()).rejects.toThrow("returned 500")
  })

  it("throws when the session list cannot be read", async () => {
    stubReplies({ status: 500 })

    await expect(new OpencodeAgent("frontend").clearSessions()).rejects.toThrow("returned 500")
  })
})

describe("OpencodeAgent.createSession", () => {
  it("posts the title and returns the id of the new session", async () => {
    const fetchMock = stubFetch(200, { data: { id: "ses_new" } })

    const created = await new OpencodeAgent("frontend").createSession("F14-3 mark sold")

    expect(created).toEqual({ id: "ses_new" })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://opencode.test/api/session")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ title: "F14-3 mark sold" })
  })

  it("sends basic auth and a JSON content type", async () => {
    const fetchMock = stubFetch(200, { data: { id: "ses_new" } })

    await new OpencodeAgent("frontend").createSession("title")

    const { headers } = fetchMock.mock.calls[0][1]
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("opencode:secret").toString("base64")}`)
    expect(headers["Content-Type"]).toBe("application/json")
  })

  it("throws when the server answers with an error", async () => {
    stubFetch(500, {})

    await expect(new OpencodeAgent("frontend").createSession("title")).rejects.toThrow("returned 500")
  })

  it("throws when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("connection refused")))

    await expect(new OpencodeAgent("frontend").createSession("title")).rejects.toThrow("connection refused")
  })
})
