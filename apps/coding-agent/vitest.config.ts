import { defineConfig, mergeConfig } from "vite-plus";

import vitestShared from "../../vitest.shared.ts";

const { onGitHubActions, testBaseConfig, workspaceSourcePaths } = vitestShared;

export default mergeConfig(
  testBaseConfig,
  defineConfig({
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
    test: {
      env: {
        CLAUDE_BIN: "/nonexistent/claude",
        MSA_OFFLINE: "1",
        OPENCODE_BIN: "/nonexistent/opencode",
      },
      environment: "node",
      globals: true,
      reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
      server: {
        deps: {
          external: [/@silvia-odwyer\/photon-node/u],
        },
      },
      silent: "passed-only",
      unstubEnvs: true,
    },
  }),
);
