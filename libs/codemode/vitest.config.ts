import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
  },
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
});
