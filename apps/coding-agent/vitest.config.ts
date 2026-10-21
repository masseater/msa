import { tmpdir } from "node:os";

import { defineConfig, mergeConfig } from "vite-plus";

import vitestShared from "../../vitest.shared.ts";

const { onGitHubActions, testBaseConfig, workspaceSourcePaths } = vitestShared;

const agentDir = `${tmpdir()}/msa-test-agent-${process.pid}`;

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
        MSA_CODING_AGENT_DIR: agentDir,
        MSA_OFFLINE: "1",
        OPENCODE_BIN: "/nonexistent/opencode",
      },
      environment: "node",
      globalSetup: ["./test/global-setup.ts"],
      globals: true,
      reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
      server: {
        deps: {
          external: [/@silvia-odwyer\/photon-node/u],
        },
      },
      silent: "passed-only",
      testTimeout: 30000,
      unstubEnvs: true,
    },
  }),
);
