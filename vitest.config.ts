import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  oxc: {
    // tsconfig has `jsx: "preserve"` (Next.js default) — vitest would leave JSX
    // untransformed and rolldown cannot parse it. Only affects vitest's own
    // transform pipeline (next build uses SWC, not this config).
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    passWithNoTests: true,
  },
});