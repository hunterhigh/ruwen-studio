import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./scripts/test-postgres.ts"],
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    restoreMocks: true,
    // LocalDirFS snapshots fsync many files; bound parallel suites to avoid I/O starvation.
    maxWorkers: 2,
  },
});
