import { defineConfig } from "vite-plus";

import vitestShared from "../../vitest.shared.ts";

const { testTimeout } = vitestShared;

export default defineConfig({
  resolve: {
    conditions: ["source"],
  },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    testTimeout,
  },
});
