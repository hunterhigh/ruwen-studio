import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    globalSetup: ["./scripts/test-postgres.ts"],
    setupFiles: ["./scripts/test-security-env.ts"],
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    restoreMocks: true,
    // LocalDirFS snapshots fsync many files; bound parallel suites to avoid I/O starvation.
    maxWorkers: 2,
  },
});
