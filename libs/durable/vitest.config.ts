import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

const durableSrcIndex = fileURLToPath(new URL("./src/index.ts", import.meta.url));
const durableSrcTesting = fileURLToPath(new URL("./src/testing/index.ts", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup-document-retention.ts"],
    projects: [
      { test: { name: "retaining" } },
      { test: { name: "evicting", env: { MSA_DURABLE_DOCUMENT_RETENTION_MS: "0" } } },
    ],
  },
  resolve: {
    conditions: ["source"],
    alias: [
      { find: /^@msa\/durable$/, replacement: durableSrcIndex },
      { find: /^@msa\/durable\/testing$/, replacement: durableSrcTesting },
    ],
  },
  ssr: { resolve: { conditions: ["source"] } },
});
