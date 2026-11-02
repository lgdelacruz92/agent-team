import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../src/config.js", () => ({
  config: {
    vikunjaUrl: "http://vikunja.test",
    vikunjaToken: "secret",
    vikunjaTimeoutMs: 1000,
    projectId: 7,
  },
}))

type Reply = { status?: number; body?: unknown }

// Replaces fetch with a stub that serves the queued replies in order.
const stubFetch = (...replies: Reply[]) => {
  const fetchMock = vi.fn()

  for (const reply of replies) {
    const status = reply.status ?? 200
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body ?? ""),
    })
  }

  vi.stubGlobal("fetch", fetchMock)

  return fetchMock
}

const views = { body: [{ id: 3, view_kind: "list" }, { id: 4, view_kind: "kanban" }] }

// Loads a fresh module so each test gets a fresh singleton.
const load = async () => {
  vi.resetModules()

  return import("../src/services/vikunja.js")
}

describe("Vikunja", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("returns the same instance every time", async () => {
    const { Vikunja } = await load()

    expect(Vikunja.getInstance()).toBe(Vikunja.getInstance())
  })

  it("builds the client from config and sends the bearer token", async () => {
    const fetchMock = stubFetch({ body: { id: 1 } })
    const { Vikunja } = await load()

    await Vikunja.getInstance().getTask(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://vikunja.test/api/v1/tasks/1")
    expect(init.method).toBe("GET")
    expect(init.headers.Authorization).toBe("Bearer secret")
  })

  it("throws an HttpError carrying the status on a failed request", async () => {
    stubFetch({ status: 404, body: "nope" })
    const { Vikunja, HttpError } = await load()

    const error = await Vikunja.getInstance().getTask(1).catch((err) => err)

    expect(error).toBeInstanceOf(HttpError)
    expect(error.status).toBe(404)
    expect(error.message).toContain("GET /tasks/1 returned 404")
  })

  it("lists buckets from the kanban view", async () => {
    const buckets = [{ id: 1, title: "Ready", tasks: [] }]
    const fetchMock = stubFetch(views, { body: buckets })
    const { Vikunja } = await load()

    expect(await Vikunja.getInstance().listBuckets()).toEqual(buckets)
    expect(fetchMock.mock.calls[1][0]).toBe("http://vikunja.test/api/v1/projects/7/views/4/tasks?per_page=200")
  })

  it("fails when the project has no kanban view", async () => {
    stubFetch({ body: [{ id: 3, view_kind: "list" }] })
    const { Vikunja } = await load()

    await expect(Vikunja.getInstance().listBuckets()).rejects.toThrow("project 7 has no Kanban view")
  })

  it("moves a task to a bucket, matching the title case-insensitively", async () => {
    const buckets = [{ id: 11, title: "In progress", tasks: [] }]
    const fetchMock = stubFetch(views, views, { body: buckets }, { body: {} })
    const { Vikunja } = await load()

    await Vikunja.getInstance().moveTask(42, "IN PROGRESS")

    const [url, init] = fetchMock.mock.calls[3]
    expect(url).toBe("http://vikunja.test/api/v1/projects/7/views/4/buckets/11/tasks")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      task_id: 42,
      bucket_id: 11,
      project_view_id: 4,
      project_id: 7,
    })
  })

  it("fails to move a task into a bucket that does not exist", async () => {
    const fetchMock = stubFetch(views, views, { body: [{ id: 1, title: "Ready", tasks: [] }] })
    const { Vikunja } = await load()

    await expect(Vikunja.getInstance().moveTask(42, "Done")).rejects.toThrow('no "Done" column')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("lists comments oldest first and treats null as empty", async () => {
    stubFetch(
      { body: [{ id: 2, created: "b", comment: "second" }, { id: 1, created: "a", comment: "first" }] },
      { body: null },
    )
    const { Vikunja } = await load()
    const vikunja = Vikunja.getInstance()

    expect((await vikunja.listComments(5)).map((c) => c.id)).toEqual([1, 2])
    expect(await vikunja.listComments(5)).toEqual([])
  })

  it("adds a comment with PUT", async () => {
    const fetchMock = stubFetch({ body: {} })
    const { Vikunja } = await load()

    await Vikunja.getInstance().addComment(5, "hello")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://vikunja.test/api/v1/tasks/5/comments")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body)).toEqual({ comment: "hello" })
  })

  it("retries a failed write once", async () => {
    vi.useFakeTimers()
    const fetchMock = stubFetch({ status: 500, body: "boom" }, { body: {} })
    const { Vikunja } = await load()

    const pending = Vikunja.getInstance().addComment(5, "hello")
    await vi.advanceTimersByTimeAsync(500)
    await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("rejects when the retry also fails", async () => {
    vi.useFakeTimers()
    stubFetch({ status: 500, body: "boom" }, { status: 500, body: "boom" })
    const { Vikunja } = await load()

    const pending = Vikunja.getInstance().addComment(5, "hello")
    const assertion = expect(pending).rejects.toThrow("returned 500")
    await vi.advanceTimersByTimeAsync(500)

    await assertion
  })

  it("runs writes one at a time", async () => {
    const order: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const comment = JSON.parse(init.body as string).comment
      order.push(`start ${comment}`)

      if (comment === "first") {
        await gate
      }

      order.push(`end ${comment}`)

      return { ok: true, status: 200, json: async () => ({}), text: async () => "" }
    })
    vi.stubGlobal("fetch", fetchMock)

    const { Vikunja } = await load()
    const vikunja = Vikunja.getInstance()
    const first = vikunja.addComment(1, "first")
    const second = vikunja.addComment(1, "second")

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(order).toEqual(["start first"])

    release()
    await Promise.all([first, second])

    expect(order).toEqual(["start first", "end first", "start second", "end second"])
  })
})
