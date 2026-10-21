import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    conditions: ["source"],
  },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
  },
});
