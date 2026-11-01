# Coding Standards: Node.js / Express (TypeScript)

These standards apply to all code written in this project. The agent MUST follow them when writing or modifying code. Where an existing file does not yet comply, bring it into compliance whenever you touch it.

## 1. Project structure

Source code lives under `src/` and is organised into the following directories:

```
src
├── interfaces    # Type and interface definitions
├── services      # Business logic and clients for external systems
└── components    # Reusable building blocks
```

- Place each piece of code in the directory that matches its responsibility.
- Do not put type definitions in `services` or `components`; put them in `interfaces`.

## 2. Comments

- Code MUST be commented so that a reader unfamiliar with it can follow it.
- Every file starts with a comment stating its purpose.
- Every exported function, class and interface has a comment explaining what it does and why it exists.
- Comment non-obvious decisions, assumptions and workarounds, not only what the code does.

## 3. Control flow

### 3.1 Always use braces

Every `if`, `else`, `for` and `while` body MUST be enclosed in braces and placed on its own line, even when it is a single statement.

Not allowed:

```ts
if (inProgress.length) await this.watch(board, inProgress[0])
```

Required:

```ts
if (inProgress.length) {
  await this.watch(board, inProgress[0])
}
```

### 3.2 Avoid conditional expressions

Do not use the ternary operator (`? :`) for control flow. Use an `if` statement with an explicit `return` instead, and give the function a block body.

Not allowed:

```ts
export const reportBody = (comment: string) =>
  comment.startsWith(reportHeader) ? comment.slice(reportHeader.length).replace(/^[^\n]*\n/, "").trim() : null
```

Required:

```ts
export const reportBody = (comment: string) => {
  if (comment.startsWith(reportHeader)) {
    return comment.slice(reportHeader.length).replace(/^[^\n]*\n/, "").trim()
  }

  return null
}
```

## 4. Environment variables

- Every environment variable MUST be read in one place: a block at the top of the module that owns it (normally `config.ts`).
- Do not read `process.env` inline inside objects, functions or expressions further down the file.
- Read each variable into a named constant, applying its default and any normalisation there, so all inputs are visible at a glance.
- Prefix the constants with an underscore (for example `_vikunjaUrl`).

Not allowed:

```ts
export const config = {
  vikunjaUrl: (process.env.VIKUNJA_URL ?? "http://host.docker.internal:3456").replace(/\/$/, ""),
}
```

Required:

```ts
// ---- Environment variables ----
const _vikunjaUrl = (process.env.VIKUNJA_URL ?? "http://host.docker.internal:3456").replace(/\/$/, "")

// ---- Config built from the values above ----
export const config = {
  vikunjaUrl: _vikunjaUrl,
}
```

## 5. Formatting and whitespace

Whitespace is used to make code easy to read.

- Separate top-level statements and declarations with a blank line. This includes each route registration, function, class and exported constant.
- Multi-line statements (such as a route handler with a body) are followed by a blank line.
- Group related one-line statements together, and separate unrelated groups with a blank line.
- Put a blank line before a `return` that follows other statements.

Not allowed:

```ts
app.post("/pause", (_req, res) => {
  controller.paused = true
  res.json({ paused: true })
})
app.post("/resume", (_req, res) => {
  controller.paused = false
  res.json({ paused: false })
})
```

Required:

```ts
app.post("/pause", (_req, res) => {
  controller.paused = true
  res.json({ paused: true })
})

app.post("/resume", (_req, res) => {
  controller.paused = false
  res.json({ paused: false })
})
```

## 6. Checklist before finishing a change

- [ ] Code is in the correct `src` directory.
- [ ] Files, exports and non-obvious logic are commented.
- [ ] No brace-less `if`, and no ternary used for control flow.
- [ ] No inline `process.env`; all variables are declared at the top of the module.
- [ ] Blank lines separate declarations, routes and logical groups.
