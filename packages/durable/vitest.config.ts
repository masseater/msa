import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const durableSrcIndex = fileURLToPath(new URL("./src/index.ts", import.meta.url));
const durableSrcTesting = fileURLToPath(new URL("./src/testing/index.ts", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup-document-retention.ts"],
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
