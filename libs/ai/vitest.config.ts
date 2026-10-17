import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

import { onGitHubActions } from "../../vite.config.ts";

const telemetrySrcIndex = fileURLToPath(new URL("../telemetry/src/index.ts", import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
    silent: "passed-only",
  },
  resolve: {
    alias: [{ find: /^@msa\/telemetry$/u, replacement: telemetrySrcIndex }],
  },
});
