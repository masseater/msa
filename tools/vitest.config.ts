import { defineConfig } from "vite-plus";

import vitestShared from "../vitest.shared.ts";

const { onGitHubActions } = vitestShared;

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
    silent: "passed-only",
    testTimeout: 120_000,
  },
});
