import js from "@eslint/js"
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"

export default defineConfig([
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/naming-convention": ["error", {
        selector: "classMethod",
        modifiers: ["private"],
        format: null,
        custom: { regex: "^_", match: true },
      }],
    },
  },
])
