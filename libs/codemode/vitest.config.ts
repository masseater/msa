import { defineConfig } from "vite-plus";

import { onGitHubActions } from "../../vite.config.ts";

export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    environment: "node",
    globals: true,
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
  },
});
