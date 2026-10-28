import { tmpdir } from "node:os";

import { defineConfig, mergeConfig } from "vite-plus";

import classSealTransform from "../../tools/class-seal/transform.ts";
import vitestShared from "../../vitest.shared.ts";

const { noLocalLlmSetup, onGitHubActions, testBaseConfig, workspaceSourcePaths } = vitestShared;

const agentDir = `${tmpdir()}/msa-test-agent-${process.pid}`;

const sealedDirs = [
  `${import.meta.dirname}/src/`,
  `${import.meta.dirname}/test/fixtures/class-seal/`,
];
const classSealRuntime = `${import.meta.dirname}/src/core/platform/node/class-seal.ts`;
const classSealTui = `${import.meta.dirname}/src/core/platform/node/class-seal-tui.ts`;

const classSeal = {
  enforce: "pre" as const,
  name: "msa-class-seal",
  transform(code: string, id: string) {
    const [file = id] = id.split("?");
    const sealed =
      sealedDirs.some((dir) => file.startsWith(dir)) &&
      file.endsWith(".ts") &&
      !file.endsWith(".d.ts") &&
      file !== classSealRuntime;
    return sealed
      ? classSealTransform.sealModule(code, {
          filename: file,
          module: classSealTransform.moduleOf(import.meta.dirname, file),
          runtime: classSealTransform.relativeSpecifier(file, classSealRuntime),
          shared: classSealTransform.relativeSpecifier(file, classSealTui),
        })
      : undefined;
  },
};

export default mergeConfig(
  testBaseConfig,
  defineConfig({
    plugins: [classSeal],
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
      setupFiles: [noLocalLlmSetup],
      silent: "passed-only",
      testTimeout: 30000,
      unstubEnvs: true,
    },
  }),
);
