import { afterEach, describe, expect, it, vi } from "vitest"
import { OpencodeSession } from "../src/services/opencode-session.js"

vi.mock("../src/config.js", () => ({
  config: {
    opencodeUrl: "http://opencode.test",
    opencodeUser: "opencode",
    opencodePassword: "secret",
    opencodeTimeoutMs: 1000,
  },
}))

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

// A session already bound to an id, without a request: init() is what POSTs, so tests set the id directly.
const bound = (id: string) => Object.assign(new OpencodeSession(), { id })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("OpencodeSession.prompt", () => {
  it("posts the text with basic auth", async () => {
    const fetchMock = stubReplies({ status: 200, body: { data: { id: "msg_1" } } })

    await bound("ses_1").prompt("do the ticket")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://opencode.test/api/session/ses_1/prompt")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ text: "do the ticket" })
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("opencode:secret").toString("base64")}`)
  })

  it("throws when the server answers with an error", async () => {
    stubReplies({ status: 404 })

    await expect(bound("ses_1").prompt("x")).rejects.toThrow("returned 404")
  })
})

describe("OpencodeSession.waitForIdle", () => {
  it("is true when the wait route answers", async () => {
    const fetchMock = stubReplies({ status: 204 })

    expect(await bound("ses_1").waitForIdle(1000)).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe("http://opencode.test/api/experimental/session/ses_1/wait")
  })

  it("is false when the session is still working after the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError")),
    )

    expect(await bound("ses_1").waitForIdle(10)).toBe(false)
  })

  it("throws on other failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("connection refused")))

    await expect(bound("ses_1").waitForIdle(10)).rejects.toThrow("connection refused")
  })
})

describe("OpencodeSession.abort", () => {
  it("posts to the interrupt route", async () => {
    const fetchMock = stubReplies({ status: 200, body: { interrupted: true } })

    await bound("ses_1").abort()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://opencode.test/api/session/ses_1/interrupt")
    expect(init.method).toBe("POST")
  })
})

describe("OpencodeSession.messages", () => {
  const user = { id: "m1", type: "user", text: "hello" }
  const assistant = { id: "m2", type: "assistant", content: [{ type: "reasoning", text: "hmm" }, { type: "text", text: "hi" }] }

  it("keeps user and assistant text, oldest first, and skips everything else", async () => {
    const toolOnly = { id: "m3", type: "assistant", content: [{ type: "tool" }] }
    const idle = { id: "m4", type: "idle" }
    const fetchMock = stubReplies({ status: 200, body: { data: [user, assistant, toolOnly, idle], cursor: { next: null } } })

    expect(await bound("ses_1").messages()).toEqual([
      { id: "m1", role: "user", text: "hello" },
      { id: "m2", role: "assistant", text: "hi" },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe("http://opencode.test/api/session/ses_1/message?order=asc")
  })

  it("follows the cursor to the next page", async () => {
    const fetchMock = stubReplies(
      { status: 200, body: { data: [user], cursor: { next: "c1" } } },
      { status: 200, body: { data: [assistant], cursor: { next: null } } },
    )

    const messages = await bound("ses_1").messages()

    expect(messages.map((message) => message.id)).toEqual(["m1", "m2"])
    expect(fetchMock.mock.calls[1][0]).toBe("http://opencode.test/api/session/ses_1/message?cursor=c1")
  })

  it("stops when the server repeats a cursor", async () => {
    stubReplies(
      { status: 200, body: { data: [user], cursor: { next: "c1" } } },
      { status: 200, body: { data: [], cursor: { next: "c1" } } },
    )

    expect(await bound("ses_1").messages()).toHaveLength(1)
  })
})

describe("OpencodeSession.delete", () => {
  it("deletes the session", async () => {
    const fetchMock = stubReplies({ status: 200 })

    await bound("ses_1").delete()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://opencode.test/api/session/ses_1")
    expect(init.method).toBe("DELETE")
  })

  it("treats a session that is already gone as deleted", async () => {
    stubReplies({ status: 404 })

    await expect(bound("ses_1").delete()).resolves.toBeUndefined()
  })

  it("throws on other failures", async () => {
    stubReplies({ status: 500 })

    await expect(bound("ses_1").delete()).rejects.toThrow("returned 500")
  })
})

describe("OpencodeSession before init", () => {
  it("refuses to call the server instead of hitting /api/session/", async () => {
    const fetchMock = stubReplies()

    await expect(new OpencodeSession().prompt("x")).rejects.toThrow("call init() first")
    await expect(new OpencodeSession().waitForIdle(10)).rejects.toThrow("call init() first")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("OpencodeSession.init", () => {
  it("posts the title, binds the id the server assigned and returns the session", async () => {
    const fetchMock = stubReplies({ status: 200, body: { data: { id: "ses_new" } } })
    const session = new OpencodeSession()

    expect(await session.init("F14-3 mark sold")).toBe(session)
    expect(session.id).toBe("ses_new")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://opencode.test/api/session")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ title: "F14-3 mark sold" })
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("opencode:secret").toString("base64")}`)
  })

  it("uses the base url it was given for this and later calls", async () => {
    const fetchMock = stubReplies({ status: 200, body: { data: { id: "ses_new" } } }, { status: 200 })

    const session = await new OpencodeSession().init("title", "http://other.test")
    await session.delete()

    expect(fetchMock.mock.calls[0][0]).toBe("http://other.test/api/session")
    expect(fetchMock.mock.calls[1][0]).toBe("http://other.test/api/session/ses_new")
  })

  it("throws when the server answers with an error", async () => {
    stubReplies({ status: 500 })

    await expect(new OpencodeSession().init("title")).rejects.toThrow("returned 500")
  })
})
