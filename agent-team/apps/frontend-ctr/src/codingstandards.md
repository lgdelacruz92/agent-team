coding standards for nodejs express

src
    | - interfaces
    | - services
    | - components


add comments so I can understand

I don't like this
```
      if (inProgress.length) await this.watch(board, inProgress[0])
```

What I like
```
          if (inProgress.length) {
            await this.watch(board, inProgress[0])
          }
          ```

space must be added to make it easier to read

Example of bad
```
app.get("/health", (_req, res) => void res.json({ ok: true }))
app.get("/status", (_req, res) => void res.json(controller.status()))
app.post("/pause", (_req, res) => {
  controller.paused = true
  res.json({ paused: true })
})
app.post("/resume", (_req, res) => {
  controller.paused = false
  res.json({ paused: false })
})
app.post("/tick", async (_req, res) => {
  const ran = await controller.tick()
  res.json({ ran, ...controller.status() })
})
```

Example of good
```
app.get("/health", (_req, res) => void res.json({ ok: true }))

app.get("/status", (_req, res) => void res.json(controller.status()))

app.post("/pause", (_req, res) => {
  controller.paused = true
  res.json({ paused: true })
})

app.post("/resume", (_req, res) => {
  controller.paused = false
  res.json({ paused: false })
})

app.post("/tick", async (_req, res) => {
  const ran = await controller.tick()
  res.json({ ran, ...controller.status() })
})
```

I don't like conditionals
```
export const reportBody = (comment: string) =>
  comment.startsWith(reportHeader) ? comment.slice(reportHeader.length).replace(/^[^\n]*\n/, "").trim() : null
```

I want this instead
```
export const reportBody = (comment: string) => {
  if (comment.startsWith(reportHeader)) {
    return comment.slice(reportHeader.length).replace(/^[^\n]*\n/, "").trim()
  } 
  return null
}
```

I don't like inlined environment variables

```
 vikunjaUrl: (process.env.VIKUNJA_URL ?? "http://host.docker.internal:3456").replace(/\/$/, "")
 ```

I want all enviroment variables defined on the top so I can see them at a quick glance
like this
```
const _vikunjaUrl = (process.env.VIKUNJA_URL ?? "http://host.docker.internal:3456").replace(/\/$/, "")

```