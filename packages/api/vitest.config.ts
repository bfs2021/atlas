import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Live tests hit real upstream APIs and only run via `pnpm test:live` (added with #141).
    exclude: ["test/live/**", "node_modules/**"],
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/**/*.types.ts"],
      reporter: ["text-summary", "html"],
    },
  },
});
