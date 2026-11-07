// Checks Kanban ticket fetching and movement without connecting to a real Vikunja server.
import assert from "node:assert/strict"
import { test } from "node:test"
import { Vikunja } from "../src/components/vikunja.js"
import type { VikunjaOptions } from "../src/components/vikunja.js"

const options: VikunjaOptions = {
  baseUrl: "https://vikunja.example/",
  token: "test-token",
  projectId: 3,
  viewId: 12,
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } })
}

function bucket(id: number, title: string, taskId: number) {
  return { id, title, count: 1, tasks: [{ id: taskId, title: `Ticket ${taskId}`, priority: id }] }
}

test("getTickets maps every column to its exact status and sends an authenticated board request", async () => {
  let calls = 0
  const request: typeof fetch = async (url, init) => {
    calls += 1
    assert.equal(String(url), "https://vikunja.example/api/v1/projects/3/views/12/tasks?page=1&per_page=50")
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token")
    assert.ok(init?.signal instanceof AbortSignal)
    assert.equal(init.signal.aborted, false)

    return json([
      bucket(1, "Ready", 10),
      bucket(2, "In progress", 20),
      bucket(3, "Retry", 30),
      bucket(4, "Done", 40),
    ])
  }

  const vikunja = new Vikunja(options, request)
  assert.deepEqual(await vikunja.getTickets(), [
    { vikunjaTaskId: 10, title: "Ticket 10", status: "Ready", priority: 1 },
    { vikunjaTaskId: 20, title: "Ticket 20", status: "In progress", priority: 2 },
    { vikunjaTaskId: 30, title: "Ticket 30", status: "Retry", priority: 3 },
    { vikunjaTaskId: 40, title: "Ticket 40", status: "Done", priority: 4 },
  ])
  assert.equal(calls, 1)
})

test("getTickets handles empty boards and null or empty column tasks", async () => {
  for (const board of [[], [
    { id: 1, title: "Ready", count: 0, tasks: null },
    { id: 2, title: "Retry", count: 0, tasks: [] },
  ]]) {
    const request: typeof fetch = async () => json(board)
    assert.deepEqual(await new Vikunja(options, request).getTickets(), [])
  }
})

test("getTickets paginates each column using its count even when the server caps page size", async () => {
  const pages: number[] = []
  const request: typeof fetch = async (url) => {
    const parsed = new URL(String(url))
    const page = Number(parsed.searchParams.get("page"))
    pages.push(page)
    assert.equal(parsed.searchParams.get("per_page"), "200")

    const response = json([
      { id: 1, title: "Ready", count: 3, tasks: [{ id: page, title: `Ticket ${page}`, priority: 0 }] },
      { id: 2, title: "Retry", count: 1, tasks: page === 1 ? [{ id: 10, title: "Retry", priority: 2 }] : null },
    ])
    // Kanban's outer pagination header does not describe the cards in each column.
    response.headers.set("x-pagination-total-pages", "1")
    return response
  }

  const tickets = await new Vikunja({ ...options, perPage: 200 }, request).getTickets()
  assert.deepEqual(pages, [1, 2, 3])
  assert.deepEqual(tickets.map((ticket) => ticket.vikunjaTaskId), [1, 10, 2, 3])
  assert.equal(tickets.find((ticket) => ticket.vikunjaTaskId === 10)?.status, "Retry")
})

test("getTickets does not return duplicate tickets from overlapping pages", async () => {
  let page = 0
  const request: typeof fetch = async () => {
    page += 1
    const ids = page === 1 ? [1, 2] : [2, 3]
    return json([{ id: 1, title: "Ready", count: 3, tasks: ids.map((id) => ({ id, title: `Ticket ${id}`, priority: 0 })) }])
  }

  const tickets = await new Vikunja(options, request).getTickets()
  assert.deepEqual(tickets.map((ticket) => ticket.vikunjaTaskId), [1, 2, 3])
  assert.equal(page, 2)
})

test("getTickets fails rather than returning incomplete results when pagination makes no progress", async () => {
  for (const tasks of [null, [{ id: 1, title: "Repeated", priority: 0 }]]) {
    const request: typeof fetch = async () => json([{ id: 1, title: "Ready", count: 2, tasks }])
    await assert.rejects(new Vikunja(options, request).getTickets(), /pagination stopped/)
  }
})

test("getTickets throws for HTTP errors without exposing the token or response body", async () => {
  for (const status of [401, 403, 404, 500]) {
    const request: typeof fetch = async () => new Response(options.token, { status })
    await assert.rejects(new Vikunja(options, request).getTickets(), (error: Error) => {
      assert.match(error.message, new RegExp(`HTTP ${status}`))
      assert.ok(!error.message.includes(options.token))
      return true
    })
  }
})

test("getTickets rejects a failed later page instead of returning the first page", async () => {
  let page = 0
  const request: typeof fetch = async () => {
    page += 1
    return page === 1
      ? json([{ ...bucket(1, "Ready", 1), count: 2 }])
      : new Response(null, { status: 500 })
  }
  await assert.rejects(new Vikunja(options, request).getTickets(), /page 2 returned HTTP 500/)
})

test("getTickets propagates network and timeout failures", async () => {
  for (const error of [new Error("Network unavailable"), new DOMException("Timed out", "TimeoutError")]) {
    const request: typeof fetch = async () => { throw error }
    await assert.rejects(new Vikunja(options, request).getTickets(), (actual) => actual === error)
  }
})

test("getTickets rejects malformed JSON and invalid board or task fields", async () => {
  const invalidBoards = [
    null,
    {},
    [{ id: 1, title: "Ready", tasks: [] }],
    [{ id: 1, title: "Ready", count: -1, tasks: [] }],
    [{ id: 1, title: "Ready", count: 1, tasks: {} }],
    [{ id: 1, title: "Ready", count: 1, tasks: [{ id: 1, title: "No priority" }] }],
    [{ id: 1, title: "Ready", count: 1, tasks: [{ id: 1, title: "Wrong priority", priority: "2" }] }],
    [{ id: 1, title: "Ready", count: 1, tasks: [{ id: 0, title: "Wrong ID", priority: 0 }] }],
  ]
  for (const board of invalidBoards) {
    const request: typeof fetch = async () => json(board)
    await assert.rejects(new Vikunja(options, request).getTickets(), /Vikunja response/)
  }
  const request: typeof fetch = async () => new Response("{invalid")
  await assert.rejects(new Vikunja(options, request).getTickets(), SyntaxError)
})

test("getTickets starts fresh on each call and supports a base URL path prefix", async () => {
  const request: typeof fetch = async (url) => {
    assert.equal(String(url), "https://vikunja.example/vikunja/api/v1/projects/3/views/12/tasks?page=1&per_page=50")
    return json([bucket(1, "Ready", 10)])
  }
  const vikunja = new Vikunja({ ...options, baseUrl: "https://vikunja.example/vikunja/" }, request)
  assert.deepEqual(await vikunja.getTickets(), await vikunja.getTickets())
})

test("markInProgress discovers the exact column and sends the scoped authenticated move", async () => {
  const calls: string[] = []
  const request: typeof fetch = async (url, init) => {
    calls.push(String(url))
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token")
    assert.ok(init?.signal instanceof AbortSignal)
    if (init?.method !== "POST") {
      return json([
        { id: 1, title: "Ready", count: 100, tasks: null },
        { id: 7, title: "In progress", count: 0, tasks: null },
      ])
    }
    assert.equal(new Headers(init.headers).get("Content-Type"), "application/json")
    assert.deepEqual(JSON.parse(String(init.body)), {
      task_id: 42, bucket_id: 7, project_view_id: 12, project_id: 3,
    })
    // A successful move does not need a JSON response body.
    return new Response(null, { status: 204 })
  }
  await new Vikunja({ ...options, baseUrl: "https://vikunja.example/prefix/" }, request).markInProgress(42)
  assert.deepEqual(calls, [
    "https://vikunja.example/prefix/api/v1/projects/3/views/12/tasks?page=1&per_page=50",
    "https://vikunja.example/prefix/api/v1/projects/3/views/12/buckets/7/tasks",
  ])
})

test("markInProgress rejects missing, renamed, and duplicate destination columns without writing", async () => {
  for (const board of [[], [bucket(1, "In Progress", 1)], [bucket(1, "In progress", 1), bucket(2, "In progress", 2)]]) {
    let calls = 0
    const request: typeof fetch = async (_url, init) => {
      calls += 1
      assert.notEqual(init?.method, "POST")
      return json(board)
    }
    await assert.rejects(new Vikunja(options, request).markInProgress(42), /exactly one "In progress" column/)
    assert.equal(calls, 1)
  }
})

test("markInProgress rejects invalid task IDs before making requests", async () => {
  const request: typeof fetch = async () => { assert.fail("No request should be made") }
  for (const id of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(new Vikunja(options, request).markInProgress(id), /positive safe integer/)
  }
})

test("markInProgress throws for lookup and move HTTP failures without exposing response bodies", async () => {
  for (const method of ["GET", "POST"]) {
    const request: typeof fetch = async (_url, init) => {
      if (method === "GET" || init?.method === "POST") {
        return new Response(options.token, { status: 500 })
      }
      return json([{ id: 7, title: "In progress", count: 0, tasks: null }])
    }
    await assert.rejects(new Vikunja(options, request).markInProgress(42), (error: Error) => {
      assert.match(error.message, new RegExp(`Vikunja ${method} .*HTTP 500`))
      assert.ok(!error.message.includes(options.token))
      return true
    })
  }
})

test("markInProgress propagates network and timeout failures during movement", async () => {
  for (const error of [new Error("Network unavailable"), new DOMException("Timed out", "TimeoutError")]) {
    const request: typeof fetch = async (_url, init) => {
      if (init?.method === "POST") {
        throw error
      }
      return json([{ id: 7, title: "In progress", count: 0, tasks: null }])
    }
    await assert.rejects(new Vikunja(options, request).markInProgress(42), (actual) => actual === error)
  }
})

test("markInProgress validates lookup data and refreshes the column ID on every call", async () => {
  const invalidRequest: typeof fetch = async () => json({ buckets: [] })
  await assert.rejects(new Vikunja(options, invalidRequest).markInProgress(42), /Kanban bucket array/)
  const invalidJson: typeof fetch = async () => new Response("{invalid")
  await assert.rejects(new Vikunja(options, invalidJson).markInProgress(42), SyntaxError)

  let bucketId = 6
  const request: typeof fetch = async (url, init) => {
    if (init?.method !== "POST") {
      bucketId += 1
      return json([{ id: bucketId, title: "In progress", count: 0, tasks: null }])
    }
    assert.ok(String(url).endsWith(`/buckets/${bucketId}/tasks`))
    return new Response(null, { status: 204 })
  }
  const vikunja = new Vikunja(options, request)
  await vikunja.markInProgress(42)
  await vikunja.markInProgress(42)
  assert.equal(bucketId, 8)
})

test("Vikunja rejects missing credentials and invalid connection settings", () => {
  for (const changes of [
    { token: " " },
    { projectId: 0 },
    { viewId: -1 },
    { perPage: 1.5 },
    { timeoutMs: 0 },
    { baseUrl: "file:///board" },
    { baseUrl: "https://vikunja.example/?other=value" },
    { baseUrl: "https://user:password@vikunja.example" },
  ]) {
    assert.throws(() => new Vikunja({ ...options, ...changes }))
  }
})
