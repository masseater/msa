import { fileURLToPath } from "node:url";

import { Config, Effect } from "effect";

const workspaceSourcePaths = {
  agentIndex: fileURLToPath(new URL("./libs/agent/src/index.ts", import.meta.url)),
  aiApi: fileURLToPath(new URL("./libs/ai/src/api", import.meta.url)),
  aiCompat: fileURLToPath(new URL("./libs/ai/src/compat.ts", import.meta.url)),
  aiIndex: fileURLToPath(new URL("./libs/ai/src/index.ts", import.meta.url)),
  aiOAuth: fileURLToPath(new URL("./libs/ai/src/oauth.ts", import.meta.url)),
  aiProviders: fileURLToPath(new URL("./libs/ai/src/providers", import.meta.url)),
  aiUtils: fileURLToPath(new URL("./libs/ai/src/utils", import.meta.url)),
  chordContext: fileURLToPath(new URL("./libs/chord/src/context/index.ts", import.meta.url)),
  chordDelta: fileURLToPath(new URL("./libs/chord/src/delta/index.ts", import.meta.url)),
  chordIndex: fileURLToPath(new URL("./libs/chord/src/index.ts", import.meta.url)),
  chordNode: fileURLToPath(new URL("./libs/chord/src/node.ts", import.meta.url)),
  codemodeDeclarations: fileURLToPath(
    new URL("./libs/codemode/src/declarations.ts", import.meta.url),
  ),
  codemodeIndex: fileURLToPath(new URL("./libs/codemode/src/index.ts", import.meta.url)),
  codemodeSource: fileURLToPath(new URL("./libs/codemode/src/source.ts", import.meta.url)),
  codingAgentIndex: fileURLToPath(new URL("./apps/coding-agent/src/index.ts", import.meta.url)),
  mcpIndex: fileURLToPath(new URL("./libs/mcp/src/index.ts", import.meta.url)),
  mcpOAuth: fileURLToPath(new URL("./libs/mcp/src/oauth/index.ts", import.meta.url)),
  mcpTesting: fileURLToPath(new URL("./libs/mcp/src/testing/index.ts", import.meta.url)),
  telemetryIndex: fileURLToPath(new URL("./libs/telemetry/src/index.ts", import.meta.url)),
  telemetryOtlp: fileURLToPath(new URL("./libs/telemetry/src/otlp.ts", import.meta.url)),
  telemetryTesting: fileURLToPath(
    new URL("./libs/telemetry/src/testing/index.ts", import.meta.url),
  ),
  testingIndex: fileURLToPath(new URL("./libs/testing/src/index.ts", import.meta.url)),
  tuiIndex: fileURLToPath(new URL("./libs/tui/src/index.ts", import.meta.url)),
} as const;

const testTimeout = 30_000;

const onGitHubActions = Effect.runSync(Config.withDefault(Config.Boolean("GITHUB_ACTIONS"), false));

const testBaseConfig = {
  resolve: {
    alias: [
      { find: /^@msa\/chord$/u, replacement: workspaceSourcePaths.chordIndex },
      {
        find: /^@msa\/chord\/context$/u,
        replacement: workspaceSourcePaths.chordContext,
      },
      { find: /^@msa\/chord\/delta$/u, replacement: workspaceSourcePaths.chordDelta },
      { find: /^@msa\/chord\/node$/u, replacement: workspaceSourcePaths.chordNode },
      {
        find: /^@msa\/telemetry$/u,
        replacement: workspaceSourcePaths.telemetryIndex,
      },
      { find: /^@msa\/telemetry\/otlp$/u, replacement: workspaceSourcePaths.telemetryOtlp },
      {
        find: /^@msa\/telemetry\/testing$/u,
        replacement: workspaceSourcePaths.telemetryTesting,
      },
      { find: /^@msa\/mcp$/u, replacement: workspaceSourcePaths.mcpIndex },
      { find: /^@msa\/mcp\/oauth$/u, replacement: workspaceSourcePaths.mcpOAuth },
      { find: /^@msa\/mcp\/testing$/u, replacement: workspaceSourcePaths.mcpTesting },
      { find: /^@msa\/ai$/u, replacement: workspaceSourcePaths.aiIndex },
      { find: /^@msa\/ai\/compat$/u, replacement: workspaceSourcePaths.aiCompat },
      { find: /^@msa\/ai\/oauth$/u, replacement: workspaceSourcePaths.aiOAuth },
      {
        find: /^@msa\/ai\/utils\/(.+)$/u,
        replacement: `${workspaceSourcePaths.aiUtils}/$1.ts`,
      },
      {
        find: /^@msa\/ai\/api\/(.+)$/u,
        replacement: `${workspaceSourcePaths.aiApi}/$1.ts`,
      },
      {
        find: /^@msa\/ai\/providers\/(.+)$/u,
        replacement: `${workspaceSourcePaths.aiProviders}/$1.ts`,
      },
      { find: /^@msa\/agent-core$/u, replacement: workspaceSourcePaths.agentIndex },
      { find: /^@msa\/codemode$/u, replacement: workspaceSourcePaths.codemodeIndex },
      {
        find: /^@msa\/codemode\/declarations$/u,
        replacement: workspaceSourcePaths.codemodeDeclarations,
      },
      {
        find: /^@msa\/codemode\/source$/u,
        replacement: workspaceSourcePaths.codemodeSource,
      },
      { find: /^@msa\/tui$/u, replacement: workspaceSourcePaths.tuiIndex },
      { find: /^@msa\/testing$/u, replacement: workspaceSourcePaths.testingIndex },
    ],
  },
  test: { testTimeout },
};

const vitestShared = {
  onGitHubActions,
  testBaseConfig,
  testTimeout,
  workspaceSourcePaths,
};

export default vitestShared;
