import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Reuses the app's Vite config (Vue plugin, resolution) so tests compile the same way the app does.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      setupFiles: ["test/setup.ts"],
      restoreMocks: true,
    },
  }),
);
