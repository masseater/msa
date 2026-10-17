import { defineConfig, mergeConfig } from "vite-plus";

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
          find: /^@msa\/coding-agent$/,
          replacement: workspaceSourcePaths.codingAgentIndex,
        },
      ],
    },
  }),
);
