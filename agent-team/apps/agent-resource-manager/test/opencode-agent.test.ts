// Tests server-wide state without connecting to a real OpenCode server.
import assert from "node:assert/strict"
import { test } from "node:test"
import { OpencodeAgent } from "../src/components/opencode-agent.js"

const page = (data: unknown[], next: string | null = null) => ({ data, cursor: { next } })
const session = (time: object) => ({ id: "ses_test", time })

test("reports idle for an empty server and sessions that are no longer busy", async (t) => {
  const responses = [page([]), page([session({}), session({ busy: 10, idle: 20 })])]
  t.mock.method(globalThis, "fetch", async () => Response.json(responses.shift()))
  const agent = new OpencodeAgent("http://opencode.test")

  assert.equal(await agent.state(), "idle")
  assert.equal(await agent.state(), "idle")
})

test("reports busy when any session is still working", async (t) => {
  const responses = [page([session({ busy: 10 })]), page([session({ busy: 30, idle: 20 })])]
  t.mock.method(globalThis, "fetch", async () => Response.json(responses.shift()))
  const agent = new OpencodeAgent("http://opencode.test")

  assert.equal(await agent.state(), "busy")
  assert.equal(await agent.state(), "busy")
})

test("checks later pages and passes headers and the cursor", async (t) => {
  const requests: Array<{ url: string; headers: Headers }> = []
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) })
    if (requests.length === 1) {
      return Response.json(page([session({ busy: 10, idle: 20 })], "next page"))
    }
    return Response.json(page([session({ busy: 30 })]))
  })
  const agent = new OpencodeAgent("http://opencode.test/", { Authorization: "Basic example" })

  assert.equal(await agent.state(), "busy")
  assert.equal(requests[0].url, "http://opencode.test/api/session")
  assert.equal(new URL(requests[1].url).searchParams.get("cursor"), "next page")
  assert.equal(requests[1].headers.get("authorization"), "Basic example")
})

test("returns idle only after the last page", async (t) => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1
    return Response.json(calls === 1 ? page([], "next") : page([]))
  })

  assert.equal(await new OpencodeAgent("http://opencode.test").state(), "idle")
  assert.equal(calls, 2)
})

test("reports unknown for HTTP errors, malformed JSON and invalid response shapes", async (t) => {
  const responses = [
    new Response("unauthorized", { status: 401 }),
    new Response("not JSON"),
    Response.json({ data: [] }),
    Response.json(page([{}])),
    Response.json(page([session({ busy: "10" })])),
    Response.json({ data: [], cursor: { next: 42 } }),
  ]
  t.mock.method(globalThis, "fetch", async () => responses.shift()!)
  const agent = new OpencodeAgent("http://opencode.test")

  for (let i = 0; i < 6; i += 1) {
    assert.equal(await agent.state(), "unknown")
  }
})

test("reports unknown when a pagination cursor repeats", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(page([], "repeat")))

  assert.equal(await new OpencodeAgent("http://opencode.test").state(), "unknown")
})

test("reports unknown when a later page fails or the URL is invalid", async (t) => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1
    if (calls === 1) {
      return Response.json(page([], "next"))
    }
    return new Response("error", { status: 500 })
  })

  assert.equal(await new OpencodeAgent("http://opencode.test").state(), "unknown")
  assert.equal(await new OpencodeAgent("not a URL").state(), "unknown")
  assert.equal(calls, 2)
})

test("reports unreachable for a network failure", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("connection refused")
  })

  assert.equal(await new OpencodeAgent("http://opencode.test").state(), "unreachable")
})

test("reports unreachable when the request times out", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    await new Promise<void>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
    })
    return Response.json(page([]))
  })

  assert.equal(await new OpencodeAgent("http://opencode.test", {}, 10).state(), "unreachable")
})

test("other agent operations fail explicitly until implemented", async () => {
  const agent = new OpencodeAgent("http://opencode.test")

  await assert.rejects(agent.createSession("title"), /not implemented/)
  await assert.rejects(agent.prompt("ses_test", "work"), /not implemented/)
  await assert.rejects(agent.sessionState("ses_test"), /not implemented/)
  await assert.rejects(agent.abort("ses_test"), /not implemented/)
})
