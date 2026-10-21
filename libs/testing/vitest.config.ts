import { defineConfig } from "vite-plus";

import vitestShared from "../../vitest.shared.ts";

const { onGitHubActions, testTimeout } = vitestShared;

export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    environment: "node",
    globals: true,
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
    testTimeout,
  },
});
