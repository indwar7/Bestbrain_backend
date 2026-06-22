import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    testTimeout: 20_000,
    hookTimeout: 60_000, // mongodb-memory-server can be slow to download/start
  },
});
