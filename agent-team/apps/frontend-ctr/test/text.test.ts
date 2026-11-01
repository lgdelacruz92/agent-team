import { describe, expect, it } from "vitest"
import { htmlToText } from "../src/components/text.js"
import { hasAcceptanceCriteria } from "../src/components/select.js"

describe("htmlToText", () => {
  it("turns headings, paragraphs and lists into lines", () => {
    const html = "<h3>Acceptance checklist</h3><ol><li>Form renders</li><li>Tests pass &amp; lint</li></ol><p>Done</p>"
    const text = htmlToText(html)

    // Headings keep their case, ordered lists are numbered, entities are decoded.
    expect(text).toContain("Acceptance checklist")
    expect(text).toContain("1. Form renders")
    expect(text).toContain("2. Tests pass & lint")
    expect(text).toContain("Done")
    expect(text).not.toContain("<")
  })

  it("leaves plain text such as marker comments unchanged", () => {
    const marker = "[frontend-ctr] run started\nsession: ses_1\nsoft_deadline: 2026-11-02T10:24:00Z"
    expect(htmlToText(marker)).toBe(marker)
  })
})

describe("hasAcceptanceCriteria", () => {
  it("accepts either heading", () => {
    expect(hasAcceptanceCriteria("Acceptance criteria\n- a")).toBe(true)
    expect(hasAcceptanceCriteria("Acceptance checklist\n- a")).toBe(true)
    expect(hasAcceptanceCriteria("just do it")).toBe(false)
  })
})
