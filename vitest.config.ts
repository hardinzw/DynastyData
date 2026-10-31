import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't start the Workers runtime.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "shared/**/*.test.ts", "worker/**/*.test.ts"],
  },
});
