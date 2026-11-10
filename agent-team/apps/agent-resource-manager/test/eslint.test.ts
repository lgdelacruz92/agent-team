import assert from "node:assert/strict"
import test from "node:test"
import { ESLint } from "eslint"

test("requires an underscore on private methods, not fields or other methods", async () => {
  const eslint = new ESLint()
  const [result] = await eslint.lintText(`
    export class Example {
      private field = 1
      private reconcile() { return this.field }
      private _valid() { return this.reconcile() }
      protected protectedMethod() { return this._valid() }
      public publicMethod() { return this.protectedMethod() }
    }
  `, { filePath: "src/example.ts" })

  const namingErrors = result.messages.filter((message) => message.ruleId === "@typescript-eslint/naming-convention")
  assert.equal(namingErrors.length, 1)
  assert.match(namingErrors[0].message, /reconcile/)
})
