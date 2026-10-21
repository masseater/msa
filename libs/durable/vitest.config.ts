import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

import vitestShared from "../../vitest.shared.ts";

const durableSrcIndex = fileURLToPath(new URL("./src/index.ts", import.meta.url));
const durableSrcTesting = fileURLToPath(new URL("./src/testing/index.ts", import.meta.url));

const { testTimeout } = vitestShared;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@msa\/durable$/u, replacement: durableSrcIndex },
      { find: /^@msa\/durable\/testing$/u, replacement: durableSrcTesting },
    ],
    conditions: ["source"],
  },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    projects: [
      { test: { name: "retaining" } },
      { test: { env: { MSA_DURABLE_DOCUMENT_RETENTION_MS: "0" }, name: "evicting" } },
    ],
    setupFiles: ["./test/setup-document-retention.ts"],
    testTimeout,
  },
});
