import { defineConfig, mergeConfig } from "vite-plus";

import { testBaseConfig, workspaceSourcePaths } from "../../vite.config.ts";

export default mergeConfig(
  testBaseConfig,
  defineConfig({
    test: {
      globals: true,
      environment: "node",
      testTimeout: 30000,
      // Tests run offline by default; opt in with allowNetwork() from test/test-network-env.ts.
      env: { MSA_OFFLINE: "1" },
      unstubEnvs: true,
      reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
      silent: "passed-only",
      server: {
        deps: {
          external: [/@silvia-odwyer\/photon-node/],
        },
      },
    },
    resolve: {
      alias: [
        { find: /^@msa\/ai$/, replacement: workspaceSourcePaths.aiIndex },
        { find: /^@msa\/agent-core$/, replacement: workspaceSourcePaths.agentIndex },
        { find: /^@mariozechner\/msa-ai$/, replacement: workspaceSourcePaths.aiIndex },
        { find: /^@mariozechner\/msa-ai\/oauth$/, replacement: workspaceSourcePaths.aiOAuth },
        { find: /^@mariozechner\/msa-agent-core$/, replacement: workspaceSourcePaths.agentIndex },
        { find: /^@mariozechner\/msa-tui$/, replacement: workspaceSourcePaths.tuiIndex },
      ],
    },
  }),
);
