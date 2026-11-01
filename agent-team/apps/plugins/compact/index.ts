import { Plugin } from "@opencode/plugin"

// Lets an agent compact its own session when asked, e.g. "compact your context".
// Compaction is queued and runs at the next step boundary, so it takes effect after this turn's work.
export default Plugin.define({
  id: "compact",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "compact",
        description:
          "Compact your own conversation context into a summary to free up the context window. " +
          "Call it when the user asks you to compact, compress, trim or clear your context. Takes no arguments.",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async (_input: unknown, context: { sessionID: string }) => {
          try {
            await ctx.session.compact({ sessionID: context.sessionID })
            return { content: "Compaction queued. It runs at the next step boundary, right after this reply." }
          } catch (err) {
            return { content: `Compaction failed: ${err instanceof Error ? err.message : String(err)}` }
          }
        },
      })
    })
  },
})
