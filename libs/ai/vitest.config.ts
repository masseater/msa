import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

const telemetrySrcIndex = fileURLToPath(new URL("../telemetry/src/index.ts", import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // 30 seconds for API calls
    testTimeout: 30000,
    reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
    silent: "passed-only",
  },
  resolve: {
    alias: [{ find: /^@msa\/telemetry$/u, replacement: telemetrySrcIndex }],
  },
});
