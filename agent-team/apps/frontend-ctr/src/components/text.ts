// Pure: turn the HTML that Vikunja's editor stores into plain text. No I/O.
import { convert } from "html-to-text"

// Keeps headings in their original case; the library uppercases them by default.
const headingSelectors = ["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({
  selector,
  options: { uppercase: false },
}))

// Converts Vikunja HTML (descriptions and comments) to plain text.
// Text that has no HTML tags is returned unchanged, so the controller's own marker comments are safe:
// the library would otherwise collapse their line breaks.
export function htmlToText(text: string): string {
  if (!/<\/?[a-z][^>]*>/i.test(text)) {
    return text
  }

  return convert(text, { wordwrap: false, selectors: headingSelectors })
}
