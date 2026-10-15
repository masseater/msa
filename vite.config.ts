import { fileURLToPath } from "node:url";

import { presets as effectPresets } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "vite-plus";

import { engine, generated, restrictedImports } from "./lint.config.ts";

type Rules = Readonly<Record<string, "error">>;

const asErrors = (names: readonly string[]): Rules =>
  Object.fromEntries(names.map((name) => [name, "error"] as const));

const effectRules = asErrors(
  Object.values(effectPresets).flatMap((preset) => Object.keys(preset.rules ?? {})),
);

export const workspaceSourcePaths = {
  chordIndex: fileURLToPath(new URL("./packages/chord/src/index.ts", import.meta.url)),
  chordContext: fileURLToPath(new URL("./packages/chord/src/context/index.ts", import.meta.url)),
  chordDelta: fileURLToPath(new URL("./packages/chord/src/delta/index.ts", import.meta.url)),
  chordNode: fileURLToPath(new URL("./packages/chord/src/node.ts", import.meta.url)),
  telemetryIndex: fileURLToPath(new URL("./packages/telemetry/src/index.ts", import.meta.url)),
  telemetryTesting: fileURLToPath(
    new URL("./packages/telemetry/src/testing/index.ts", import.meta.url),
  ),
  mcpIndex: fileURLToPath(new URL("./packages/mcp/src/index.ts", import.meta.url)),
  mcpOAuth: fileURLToPath(new URL("./packages/mcp/src/oauth/index.ts", import.meta.url)),
  mcpTesting: fileURLToPath(new URL("./packages/mcp/src/testing/index.ts", import.meta.url)),
  aiIndex: fileURLToPath(new URL("./packages/ai/src/index.ts", import.meta.url)),
  aiCompat: fileURLToPath(new URL("./packages/ai/src/compat.ts", import.meta.url)),
  aiOAuth: fileURLToPath(new URL("./packages/ai/src/oauth.ts", import.meta.url)),
  aiApi: fileURLToPath(new URL("./packages/ai/src/api", import.meta.url)),
  aiProviders: fileURLToPath(new URL("./packages/ai/src/providers", import.meta.url)),
  aiUtils: fileURLToPath(new URL("./packages/ai/src/utils", import.meta.url)),
  agentIndex: fileURLToPath(new URL("./packages/agent/src/index.ts", import.meta.url)),
  codemodeIndex: fileURLToPath(new URL("./packages/codemode/src/index.ts", import.meta.url)),
  codemodeDeclarations: fileURLToPath(
    new URL("./packages/codemode/src/declarations.ts", import.meta.url),
  ),
  codemodeSource: fileURLToPath(new URL("./packages/codemode/src/source.ts", import.meta.url)),
  codingAgentIndex: fileURLToPath(new URL("./packages/coding-agent/src/index.ts", import.meta.url)),
  tuiIndex: fileURLToPath(new URL("./packages/tui/src/index.ts", import.meta.url)),
} as const;

export const testBaseConfig = {
  resolve: {
    alias: [
      { find: /^@earendil-works\/chord$/u, replacement: workspaceSourcePaths.chordIndex },
      {
        find: /^@earendil-works\/chord\/context$/u,
        replacement: workspaceSourcePaths.chordContext,
      },
      { find: /^@earendil-works\/chord\/delta$/u, replacement: workspaceSourcePaths.chordDelta },
      { find: /^@earendil-works\/chord\/node$/u, replacement: workspaceSourcePaths.chordNode },
      {
        find: /^@earendil-works\/pi-telemetry$/u,
        replacement: workspaceSourcePaths.telemetryIndex,
      },
      {
        find: /^@earendil-works\/pi-telemetry\/testing$/u,
        replacement: workspaceSourcePaths.telemetryTesting,
      },
      { find: /^@earendil-works\/pi-mcp$/u, replacement: workspaceSourcePaths.mcpIndex },
      { find: /^@earendil-works\/pi-mcp\/oauth$/u, replacement: workspaceSourcePaths.mcpOAuth },
      { find: /^@earendil-works\/pi-mcp\/testing$/u, replacement: workspaceSourcePaths.mcpTesting },
      { find: /^@earendil-works\/pi-ai$/u, replacement: workspaceSourcePaths.aiIndex },
      { find: /^@earendil-works\/pi-ai\/compat$/u, replacement: workspaceSourcePaths.aiCompat },
      { find: /^@earendil-works\/pi-ai\/oauth$/u, replacement: workspaceSourcePaths.aiOAuth },
      {
        find: /^@earendil-works\/pi-ai\/utils\/(.+)$/u,
        replacement: `${workspaceSourcePaths.aiUtils}/$1.ts`,
      },
      {
        find: /^@earendil-works\/pi-ai\/api\/(.+)$/u,
        replacement: `${workspaceSourcePaths.aiApi}/$1.ts`,
      },
      {
        find: /^@earendil-works\/pi-ai\/providers\/(.+)$/u,
        replacement: `${workspaceSourcePaths.aiProviders}/$1.ts`,
      },
      { find: /^@earendil-works\/pi-agent-core$/u, replacement: workspaceSourcePaths.agentIndex },
      { find: /^@earendil-works\/pi-codemode$/u, replacement: workspaceSourcePaths.codemodeIndex },
      {
        find: /^@earendil-works\/pi-codemode\/declarations$/u,
        replacement: workspaceSourcePaths.codemodeDeclarations,
      },
      {
        find: /^@earendil-works\/pi-codemode\/source$/u,
        replacement: workspaceSourcePaths.codemodeSource,
      },
      { find: /^@earendil-works\/pi-tui$/u, replacement: workspaceSourcePaths.tuiIndex },
    ],
  },
};

export default defineConfig({
  staged: { "*": "vp check --fix" },
  fmt: {
    ignorePatterns: generated,
    sortImports: true,
    sortPackageJson: true,
  },
  lint: {
    ignorePatterns: [...generated, ...engine],
    plugins: ["oxc", "import", "promise", "node", "jsdoc", "effecttsgo"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
      pedantic: "error",
      nursery: "error",
    },
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "no-comments", specifier: "eslint-plugin-no-comments" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "no-comments/disallowComments": ["error", { allow: ["oxlint-disable", "eslint-disable"] }],
      "eslint/no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "eslint/no-restricted-imports": ["error", restrictedImports],
      "eslint/no-undef": "off",
      "eslint/one-var": ["error", "never"],
      "eslint/sort-imports": "off",
      "eslint/sort-keys": "off",
      "import/no-named-export": "off",
      "import/prefer-default-export": "off",
      "node/no-top-level-await": "off",
      ...effectRules,
    },
    options: {
      typeAware: true,
      typeCheck: true,
      denyWarnings: true,
      reportUnusedDisableDirectives: "error",
    },
  },
  run: {
    cache: true,
    tasks: {
      verify: {
        command: "vp check",
        dependsOn: ["engine-checks", "fence-check", "syncpack", "fallow-all", "audit", "test-all"],
      },
      "engine-checks": {
        command:
          "node scripts/check-ts-relative-imports.mjs && node scripts/check-entry-graphs.mjs && node scripts/check-browser-smoke.mjs",
      },
      "fence-check": "node tools/fence-counts.ts",
      "fallow-all": "vp run -r fallow",
      syncpack: "syncpack lint",
      gitleaks: {
        command:
          'go run github.com/zricethezav/gitleaks/v8@v8.30.1 git --redact --no-banner --log-opts="$(git rev-parse -q --verify "$GITLEAKS_BASE" || echo origin/main)..HEAD"',
        cache: false,
      },
      audit: {
        command: "vp pm audit",
        cache: false,
      },
      "daemon-build": {
        command: "vp run --filter @earendil-works/pi-env build:daemon",
        cache: false,
      },
      test: {
        command: "vp run --no-cache test:scripts && vp run --no-cache -r test",
        cache: false,
      },
      "test-all": {
        command: "bash test.sh",
        cache: false,
        dependsOn: ["build", "daemon-build", "engine-checks", "fence-check"],
      },
    },
  },
});
