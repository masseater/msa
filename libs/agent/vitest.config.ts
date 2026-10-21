import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

import vitestShared from "../../vitest.shared.ts";

const { onGitHubActions, testTimeout } = vitestShared;

const telemetrySrcIndex = fileURLToPath(new URL("../telemetry/src/index.ts", import.meta.url));
const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const aiSrcCompat = fileURLToPath(new URL("../ai/src/compat.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("./src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@msa\/telemetry$/u, replacement: telemetrySrcIndex },
      { find: /^@msa\/agent-core$/u, replacement: agentSrcIndex },
      { find: /^@msa\/ai$/u, replacement: aiSrcIndex },
      { find: /^@msa\/ai\/compat$/u, replacement: aiSrcCompat },
    ],
    conditions: ["source"],
  },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    environment: "node",
    globals: true,
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
    silent: "passed-only",
    testTimeout,
  },
});
