import { defineConfig, mergeConfig } from "vite-plus";

import {
  isolatedHomeSetup,
  onGitHubActions,
  testBaseConfig,
  workspaceSourcePaths,
} from "../../vite.config.ts";

export default mergeConfig(
  testBaseConfig,
  defineConfig({
    test: {
      globals: true,
      environment: "node",
      testTimeout: 30000,
      // Keep the machine's Claude Code and OpenCode installs out of the model lists tests see.
      env: {
        MSA_OFFLINE: "1",
        CLAUDE_BIN: "/nonexistent/claude",
        OPENCODE_BIN: "/nonexistent/opencode",
      },
      unstubEnvs: true,
      setupFiles: [isolatedHomeSetup],
      reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
      silent: "passed-only",
      server: {
        deps: {
          external: [/@silvia-odwyer\/photon-node/u],
        },
      },
    },
    resolve: {
      alias: [
        { find: /^@msa\/ai$/u, replacement: workspaceSourcePaths.aiIndex },
        { find: /^@msa\/agent-core$/u, replacement: workspaceSourcePaths.agentIndex },
        { find: /^@mariozechner\/msa-ai$/u, replacement: workspaceSourcePaths.aiIndex },
        { find: /^@mariozechner\/msa-ai\/oauth$/u, replacement: workspaceSourcePaths.aiOAuth },
        { find: /^@mariozechner\/msa-agent-core$/u, replacement: workspaceSourcePaths.agentIndex },
        { find: /^@mariozechner\/msa-tui$/u, replacement: workspaceSourcePaths.tuiIndex },
      ],
    },
  }),
);
