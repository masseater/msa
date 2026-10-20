import { defineConfig, mergeConfig } from "vite-plus";

import vitestShared from "../../vitest.shared.ts";
import { evalConfig } from "./src/vitest-evals.ts";

const { testBaseConfig, workspaceSourcePaths } = vitestShared;

const localConfig = mergeConfig(
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
  }),
);

export default mergeConfig(localConfig, evalConfig);
