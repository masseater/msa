import { defineConfig, mergeConfig } from "vitest/config";

import { testBaseConfig, workspaceSourcePaths } from "../../vite.config.ts";

export default mergeConfig(
  testBaseConfig,
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
    },
    resolve: {
      alias: [
        {
          find: /^@earendil-works\/pi-coding-agent$/,
          replacement: workspaceSourcePaths.codingAgentIndex,
        },
      ],
    },
  }),
);
