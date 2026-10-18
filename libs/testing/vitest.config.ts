import { defineConfig } from "vite-plus";

import { onGitHubActions } from "../../vite.config.ts";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
  },
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
});
