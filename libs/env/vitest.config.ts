import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    conditions: ["source"],
  },
  ssr: { resolve: { conditions: ["source"] } },
});
