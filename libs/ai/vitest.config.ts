import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

import vitestShared from "../../vitest.shared.ts";

const { noLocalLlmSetup, onGitHubActions } = vitestShared;

const telemetrySrcIndex = fileURLToPath(new URL("../telemetry/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@msa\/telemetry$/u, replacement: telemetrySrcIndex }],
    conditions: ["source"],
  },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    globals: true,
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
    setupFiles: [noLocalLlmSetup],
    silent: "passed-only",
    testTimeout: 30000,
  },
});
