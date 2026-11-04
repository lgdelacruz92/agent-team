// Checks requests for Vikunja ticket moves and labels.
import { afterEach, describe, expect, it, vi } from "vitest"
import { VikunjaAPI } from "../src/api/vikunja.api.js"
import type { VikunjaAPIInterface } from "../src/interfaces/vikunja.api.interface.js"
import { VikunjaService } from "../src/services/vikunja.service.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("VikunjaService.moveToColumn", () => {
  it("finds the destination by name and moves the ticket into its bucket", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 7, title: "IN PROGRESS", tasks: [] }] })
      .mockResolvedValueOnce({ ok: true })

    vi.stubGlobal("fetch", fetchMock)
    const service = new VikunjaService(new VikunjaAPI("http://vikunja.test", "token", 1000), 2, 3, 200)

    await service.moveToColumn(42, "In progress")

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe("http://vikunja.test/api/v1/projects/2/views/3/tasks?per_page=200")
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer token" },
      signal: expect.any(AbortSignal),
    })
    expect(fetchMock.mock.calls[1][0]).toBe("http://vikunja.test/api/v1/projects/2/views/3/buckets/7/tasks")
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: 42, bucket_id: 7, project_view_id: 3, project_id: 2 }),
      signal: expect.any(AbortSignal),
    })
  })

  it("fails without posting when the destination column is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })

    vi.stubGlobal("fetch", fetchMock)
    const service = new VikunjaService(new VikunjaAPI("http://vikunja.test", "token", 1000), 2, 3, 200)

    await expect(service.moveToColumn(42, "Review")).rejects.toThrow('Vikunja column "Review" does not exist')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("reports a failed move", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 7, title: "Review", tasks: [] }] })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => "Forbidden" })

    vi.stubGlobal("fetch", fetchMock)
    const service = new VikunjaService(new VikunjaAPI("http://vikunja.test", "token", 1000), 2, 3, 200)

    await expect(service.moveToColumn(42, "Review")).rejects.toThrow("returned 403: Forbidden")
  })

  it("reports a failed bucket lookup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "Unavailable" }))
    const service = new VikunjaService(new VikunjaAPI("http://vikunja.test", "token", 1000), 2, 3, 200)

    await expect(service.getTickets("Ready")).rejects.toThrow("returned 503: Unavailable")
  })

  it("uses the injected API for bucket reads and moves", async () => {
    const get = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 7, title: "Review", tasks: [] }])))
    const post = vi.fn().mockResolvedValue(new Response())
    const api: VikunjaAPIInterface = { get, post, put: vi.fn() }
    const service = new VikunjaService(api, 2, 3, 200)

    await service.moveToColumn(42, "Review")

    expect(get).toHaveBeenCalledWith("/projects/2/views/3/tasks?per_page=200")
    expect(post).toHaveBeenCalledWith("/projects/2/views/3/buckets/7/tasks", {
      task_id: 42,
      bucket_id: 7,
      project_view_id: 3,
      project_id: 2,
    })
  })
})

describe("VikunjaService labels", () => {
  it("returns labels from every page for a ticket", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, title: "frontend" }]), {
        headers: { "x-pagination-total-pages": "2" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 2, title: "urgent" }]), {
        headers: { "x-pagination-total-pages": "2" },
      }))
    const api: VikunjaAPIInterface = { get, post: vi.fn(), put: vi.fn() }
    const service = new VikunjaService(api, 2, 3, 200)

    await expect(service.getLabels(42)).resolves.toEqual([
      { id: 1, title: "frontend" },
      { id: 2, title: "urgent" },
    ])
    expect(get).toHaveBeenNthCalledWith(1, "/tasks/42/labels?page=1")
    expect(get).toHaveBeenNthCalledWith(2, "/tasks/42/labels?page=2")
  })

  it("returns no labels for an empty response and reports API failures", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce(new Response("null", { headers: { "x-pagination-total-pages": "0" } }))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
    const api: VikunjaAPIInterface = { get, post: vi.fn(), put: vi.fn() }
    const service = new VikunjaService(api, 2, 3, 200)

    await expect(service.getLabels(42)).resolves.toEqual([])
    await expect(service.getLabels(42)).rejects.toThrow("returned 403: Forbidden")
  })

  it("adds one label to a ticket and reports failures", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => "Forbidden" })
    vi.stubGlobal("fetch", fetchMock)
    const service = new VikunjaService(new VikunjaAPI("http://vikunja.test", "token", 1000), 2, 3, 200)

    await service.addLabel(42, 7)
    expect(fetchMock).toHaveBeenCalledWith("http://vikunja.test/api/v1/tasks/42/labels", expect.objectContaining({
      method: "PUT",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify({ label_id: 7 }),
    }))
    await expect(service.addLabel(42, 7)).rejects.toThrow("returned 403: Forbidden")
  })
})

describe("VikunjaAPI.put", () => {
  it("sends the caller's JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)
    const api = new VikunjaAPI("http://vikunja.test", "token", 1000)

    await api.put("/tasks/42", { title: "Updated task" })

    expect(fetchMock).toHaveBeenCalledWith("http://vikunja.test/api/v1/tasks/42", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ title: "Updated task" }),
    }))
  })
})
