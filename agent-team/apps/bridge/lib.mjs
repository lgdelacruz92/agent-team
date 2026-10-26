// Pure helpers for the Mattermost <-> CTO bridge.

// Mattermost rejects posts over 16383 characters, so long reports are sent as several posts.
export function splitMessage(text, limit = 15000) {
  const parts = []
  let rest = text
  while (rest.length > limit) {
    const cut = rest.lastIndexOf("\n", limit)
    const at = cut > limit / 2 ? cut : limit
    parts.push(rest.slice(0, at))
    rest = rest.slice(at).replace(/^\n+/, "")
  }
  if (rest.trim() !== "") parts.push(rest)
  return parts
}

export function stripMention(text, username) {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text.replace(new RegExp(`@${escaped}(?![\\w.-])`, "gi"), "").trim()
}

// Drops a leading word such as an outgoing webhook's trigger word.
export function stripPrefix(text, prefix) {
  if (prefix && text.toLowerCase().startsWith(prefix.toLowerCase())) return text.slice(prefix.length).trim()
  return text.trim()
}

// "alice, Bob" -> Set { "alice", "bob" }
export function parseAllowed(value) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((name) => name.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean),
  )
}
