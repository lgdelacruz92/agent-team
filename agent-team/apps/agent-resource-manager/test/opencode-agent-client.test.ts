// Tests server-wide state without connecting to a real OpenCode server.
import assert from "node:assert/strict"
import { test } from "node:test"
import { OpencodeAgentClient } from "../src/components/opencode-agent-client.js"

const page = (data: unknown[], next: string | null = null) => ({ data, cursor: { next } })
const session = (time: object) => ({ id: "ses_test", time })

test("ignores stale busy timestamps when no session is active", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    return String(input).endsWith("/api/session/active")
      ? Response.json({ data: {} })
      : Response.json(page([session({ busy: 10 })]))
  })

  assert.equal(await new OpencodeAgentClient("http://opencode.test").state(), "idle")
})

test("reports a stale session as idle while preserving its timestamps", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    return String(input).endsWith("/api/session/active")
      ? Response.json({ data: {} })
      : Response.json({ data: { id: "ses_1", time: { busy: 10 } } })
  })

  assert.deepEqual(await new OpencodeAgentClient("http://opencode.test").sessionActivity("ses_1"),
    { state: "idle", busyAt: 10, idleAt: null })
})

test("reports an active session as busy even if its last timestamps look idle", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    return String(input).endsWith("/api/session/active")
      ? Response.json({ data: { ses_1: { type: "running" } } })
      : Response.json({ data: { id: "ses_1", time: { busy: 10, idle: 20 } } })
  })

  assert.deepEqual(await new OpencodeAgentClient("http://opencode.test").sessionActivity("ses_1"),
    { state: "busy", busyAt: 10, idleAt: 20 })
})

test("does not report a session busy just because another session is active", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    return String(input).endsWith("/api/session/active")
      ? Response.json({ data: { ses_other: { type: "running" } } })
      : Response.json({ data: { id: "ses_1", time: {} } })
  })

  const agent = new OpencodeAgentClient("http://opencode.test")
  assert.equal(await agent.state(), "busy")
  assert.equal(await agent.sessionState("ses_1"), "idle")
})

test("does not infer an idle session when the active endpoint fails", async (t) => {
  let offline = false
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/api/session/active")) {
      if (offline) throw new Error("offline")
      return Response.json({ data: { ses_other: { type: "unexpected" } } })
    }
    return Response.json({ data: { id: "ses_1", time: { busy: 10, idle: 20 } } })
  })

  const agent = new OpencodeAgentClient("http://opencode.test")
  assert.equal(await agent.sessionState("ses_1"), "unknown")
  offline = true
  assert.equal(await agent.sessionState("ses_1"), "unreachable")
})

test("reports idle for an empty active-session map", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: {} }))
  const agent = new OpencodeAgentClient("http://opencode.test")

  assert.equal(await agent.state(), "idle")
})

test("reports busy when any session is still working", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: { ses_1: { type: "running" } } }))
  const agent = new OpencodeAgentClient("http://opencode.test")

  assert.equal(await agent.state(), "busy")
})

test("requests active sessions with the configured headers", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "http://opencode.test/api/session/active")
    assert.equal(new Headers(init?.headers).get("authorization"), "Basic example")
    return Response.json({ data: { ses_1: { type: "running" } } })
  })
  const agent = new OpencodeAgentClient("http://opencode.test/", { Authorization: "Basic example" })

  assert.equal(await agent.state(), "busy")
})

test("reports unknown for HTTP errors, malformed JSON and invalid response shapes", async (t) => {
  const responses = [
    new Response("unauthorized", { status: 401 }),
    new Response("not JSON"),
    Response.json({ data: [] }),
    Response.json({ data: { bad_id: { type: "running" } } }),
    Response.json({ data: { ses_1: null } }),
    Response.json({ data: { ses_1: { type: "idle" } } }),
  ]
  t.mock.method(globalThis, "fetch", async () => responses.shift()!)
  const agent = new OpencodeAgentClient("http://opencode.test")

  for (let i = 0; i < 6; i += 1) {
    assert.equal(await agent.state(), "unknown")
  }
})

test("reports unknown when the active endpoint fails or the URL is invalid", async (t) => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1
    return new Response("error", { status: 500 })
  })

  assert.equal(await new OpencodeAgentClient("http://opencode.test").state(), "unknown")
  assert.equal(await new OpencodeAgentClient("not a URL").state(), "unknown")
  assert.equal(calls, 1)
})

test("reports unreachable for a network failure", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("connection refused")
  })

  assert.equal(await new OpencodeAgentClient("http://opencode.test").state(), "unreachable")
})

test("reports unreachable when the request times out", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    await new Promise<void>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
    })
    return Response.json(page([]))
  })

  assert.equal(await new OpencodeAgentClient("http://opencode.test", {}, 10).state(), "unreachable")
})

test("creates, prompts, observes and interrupts a session", async (t) => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const responses = [Response.json({ data: { id: "ses_1" } }), Response.json({}),
    Response.json({ data: { id: "ses_1", time: { busy: 10 } } }),
    Response.json({ data: { ses_1: { type: "running" } } }), Response.json({})]
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init })
    return responses.shift()!
  })
  const agent = new OpencodeAgentClient("http://opencode.test", { Authorization: "Basic example" })
  assert.equal(await agent.createSession("title"), "ses_1")
  await agent.prompt("ses_1", "work")
  assert.equal(await agent.sessionState("ses_1"), "busy")
  await agent.abort("ses_1")
  assert.deepEqual(requests.map((request) => request.url), ["http://opencode.test/api/session", "http://opencode.test/api/session/ses_1/prompt", "http://opencode.test/api/session/ses_1", "http://opencode.test/api/session/active", "http://opencode.test/api/session/ses_1/interrupt"])
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { text: "work" })
  assert.equal(new Headers(requests[0].init?.headers).get("authorization"), "Basic example")
})

test("distinguishes a missing session from HTTP errors and network failures", async (t) => {
  const replies = [new Response(null, { status: 404 }), new Response(null, { status: 500 }), Response.json({ data: { id: "wrong", time: {} } })]
  t.mock.method(globalThis, "fetch", async () => {
    const reply = replies.shift()
    if (!reply) throw new Error("offline")
    return reply
  })
  const agent = new OpencodeAgentClient("http://opencode.test")
  assert.equal(await agent.sessionState("ses_1"), "missing")
  assert.equal(await agent.sessionState("ses_1"), "unknown")
  assert.equal(await agent.sessionState("ses_1"), "unknown")
  assert.equal(await agent.sessionState("ses_1"), "unreachable")
})

test("exposes validated session activity timestamps", async (t) => {
  const responses = [Response.json({ data: { id: "ses_1", time: { busy: 10, idle: 20 } } }), Response.json({ data: {} }),
    Response.json({ data: { id: "ses_1", time: {} } }), Response.json({ data: {} }),
    Response.json({ data: { id: "ses_1", time: { busy: "bad" } } })]
  t.mock.method(globalThis, "fetch", async () => responses.shift()!)
  const agent = new OpencodeAgentClient("http://opencode.test")
  assert.deepEqual(await agent.sessionActivity("ses_1"), { state: "idle", busyAt: 10, idleAt: 20 })
  assert.deepEqual(await agent.sessionActivity("ses_1"), { state: "idle", busyAt: null, idleAt: null })
  assert.deepEqual(await agent.sessionActivity("ses_1"), { state: "unknown", busyAt: null, idleAt: null })
})
