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

    await new OpencodeAgent("frontend", [], "http://other.test").state()

    expect(fetchMock.mock.calls[0][0]).toBe("http://other.test/api/session")
  })
})

describe("OpencodeAgent.clearSessions", () => {
  // A session stub whose delete() can be made to fail.
  const fakeSession = (id: string, failure?: Error) => ({
    id,
    prompt: vi.fn(),
    waitForIdle: vi.fn(),
    abort: vi.fn(),
    messages: vi.fn(),
    delete: failure ? vi.fn().mockRejectedValue(failure) : vi.fn().mockResolvedValue(undefined),
  })

  it("does nothing when there are no sessions", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await new OpencodeAgent("frontend").clearSessions()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("deletes every tracked session and forgets them", async () => {
    const one = fakeSession("ses_1")
    const two = fakeSession("ses_2")
    const agent = new OpencodeAgent("frontend", [one, two])

    await agent.clearSessions()

    expect(one.delete).toHaveBeenCalledTimes(1)
    expect(two.delete).toHaveBeenCalledTimes(1)
    expect(() => agent.abort("ses_1")).toThrow("has no session ses_1")
  })

  it("stops at a failed delete and keeps that session and the rest tracked", async () => {
    const one = fakeSession("ses_1")
    const two = fakeSession("ses_2", new Error("returned 500"))
    const three = fakeSession("ses_3")
    const agent = new OpencodeAgent("frontend", [one, two, three])

    await expect(agent.clearSessions()).rejects.toThrow("returned 500")

    expect(three.delete).not.toHaveBeenCalled()
    expect(() => agent.abort("ses_1")).toThrow("has no session ses_1")
    expect(() => agent.abort("ses_2")).not.toThrow("has no session")
    expect(() => agent.abort("ses_3")).not.toThrow("has no session")
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

describe("OpencodeAgent sessions", () => {
  // A session stub that records what the agent hands to it.
  const fakeSession = (id: string) => ({
    id,
    prompt: vi.fn().mockResolvedValue(undefined),
    waitForIdle: vi.fn().mockResolvedValue(true),
    abort: vi.fn().mockResolvedValue(undefined),
    messages: vi.fn().mockResolvedValue([{ id: "m1", role: "user", text: "hi" }]),
    delete: vi.fn().mockResolvedValue(undefined),
  })

  it("hands each call to the session with that id", async () => {
    const one = fakeSession("ses_1")
    const two = fakeSession("ses_2")
    const agent = new OpencodeAgent("frontend", [one, two])

    await agent.prompt("ses_2", "go")
    expect(await agent.waitForIdle("ses_2", 50)).toBe(true)
    await agent.abort("ses_2")
    expect(await agent.messages("ses_2")).toHaveLength(1)

    expect(two.prompt).toHaveBeenCalledWith("go")
    expect(two.waitForIdle).toHaveBeenCalledWith(50)
    expect(two.abort).toHaveBeenCalled()
    expect(one.prompt).not.toHaveBeenCalled()
  })

  it("throws for a session it does not know", () => {
    expect(() => new OpencodeAgent("frontend").prompt("ses_x", "go")).toThrow("has no session ses_x")
  })

  it("tracks a session it creates, and does not change the array it was given", async () => {
    const given: ReturnType<typeof fakeSession>[] = []
    const agent = new OpencodeAgent("frontend", given)
    const fetchMock = stubFetch(200, { data: { id: "ses_new" } })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })

    await agent.createSession("title")
    await agent.abort("ses_new")

    expect(given).toHaveLength(0)
    expect(fetchMock.mock.calls[1][0]).toBe("http://opencode.test/api/session/ses_new/interrupt")
  })
})
