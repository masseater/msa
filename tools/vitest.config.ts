import { defineConfig } from "vite-plus";

import { onGitHubActions } from "../vite.config.ts";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 120_000,
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
    silent: "passed-only",
  },
});
