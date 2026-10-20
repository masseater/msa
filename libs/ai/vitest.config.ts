import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

import { onGitHubActions } from "../../vite.config.ts";

const telemetrySrcIndex = fileURLToPath(new URL("../telemetry/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@msa\/telemetry$/u, replacement: telemetrySrcIndex }],
  },
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    globals: true,
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
    silent: "passed-only",
    testTimeout: 30000,
  },
});
