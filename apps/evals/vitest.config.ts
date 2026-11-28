import { defineConfig, mergeConfig } from "vite-plus";

import vitestShared from "../../vitest.shared.ts";

const { testBaseConfig, workspaceSourcePaths } = vitestShared;

export default mergeConfig(
  testBaseConfig,
  defineConfig({
    resolve: {
      alias: [
        {
          find: /^@msa\/coding-agent$/u,
          replacement: workspaceSourcePaths.codingAgentIndex,
        },
      ],
    },
    test: {
      include: ["test/**/*.test.ts"],
    },
  }),
);
