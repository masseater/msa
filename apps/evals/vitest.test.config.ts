import { defineConfig, mergeConfig } from "vite-plus";

import { isolatedHomeSetup, testBaseConfig, workspaceSourcePaths } from "../../vite.config.ts";

export default mergeConfig(
  testBaseConfig,
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: [isolatedHomeSetup],
    },
    resolve: {
      alias: [
        {
          find: /^@msa\/coding-agent$/,
          replacement: workspaceSourcePaths.codingAgentIndex,
        },
      ],
    },
  }),
);
