import { defineConfig } from "vitest/config";

// Pure/in-process suites: no Postgres bootstrap, native recovery workers, Python parity or browsers.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    setupFiles: ["./scripts/test-security-env.ts"],
    include: [
      "packages/core/test/*.test.ts",
      "packages/agents/test/*.test.ts",
      "packages/agents/spike/pi-api.test.ts",
      "packages/agents/spike/model-catalog.test.ts",
    ],
    exclude: [
      "packages/core/test/upstream-port.test.ts",
      "packages/core/test/runtime-boundary.test.ts",
    ],
    testTimeout: 10000,
    hookTimeout: 10000,
    restoreMocks: true,
    maxWorkers: 2,
  },
});
