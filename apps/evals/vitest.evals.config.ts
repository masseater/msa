import { defineConfig, mergeConfig } from "vite-plus";

import { testBaseConfig, workspaceSourcePaths } from "../../vite.config.ts";
import { evalConfig } from "./src/vitest-evals.ts";

const localConfig = mergeConfig(
  testBaseConfig,
  defineConfig({
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

export default mergeConfig(localConfig, evalConfig);
