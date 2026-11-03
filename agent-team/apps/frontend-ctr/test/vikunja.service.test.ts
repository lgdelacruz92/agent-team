// Checks the requests used to move a ticket between Vikunja columns.
import { afterEach, describe, expect, it, vi } from "vitest"
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
    const service = new VikunjaService("http://vikunja.test", "token", 1000, 2, 3, 200)

    await service.moveToColumn(42, "In progress")

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe("http://vikunja.test/api/v1/projects/2/views/3/buckets/7/tasks")
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: 42, bucket_id: 7, project_view_id: 3, project_id: 2 }),
    })
  })

  it("fails without posting when the destination column is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })

    vi.stubGlobal("fetch", fetchMock)
    const service = new VikunjaService("http://vikunja.test", "token", 1000, 2, 3, 200)

    await expect(service.moveToColumn(42, "Review")).rejects.toThrow('Vikunja column "Review" does not exist')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("reports a failed move", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 7, title: "Review", tasks: [] }] })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => "Forbidden" })

    vi.stubGlobal("fetch", fetchMock)
    const service = new VikunjaService("http://vikunja.test", "token", 1000, 2, 3, 200)

    await expect(service.moveToColumn(42, "Review")).rejects.toThrow("returned 403: Forbidden")
  })
})
