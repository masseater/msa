import { fileURLToPath } from "node:url";

import { presets as effectPresets } from "@effect/tsgo/oxlint-presets";
import { Config, Effect } from "effect";
import { defineConfig } from "vite-plus";

import { generated, lintPlugins, restrictedImports, strictCategoryRules } from "./lint.config.ts";

type Rules = Readonly<Record<string, "error">>;

const asErrors = (names: readonly string[]): Rules =>
  Object.fromEntries(names.map((name) => [name, "error"] as const));

const effectRuleNames = Object.values(effectPresets).flatMap((preset) =>
  Object.keys(preset.rules ?? {}),
);

const effectRules = asErrors(effectRuleNames);

export const workspaceSourcePaths = {
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

export const onGitHubActions = Effect.runSync(
  Config.withDefault(Config.Boolean("GITHUB_ACTIONS"), false),
);

export const testBaseConfig = {
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
};

export default defineConfig({
  fmt: {
    ignorePatterns: generated,
    sortImports: true,
    sortPackageJson: true,
  },
  lint: {
    categories: {
      correctness: "error",
      suspicious: "error",
    },
    env: { browser: true, builtin: true, node: true },
    ignorePatterns: generated,
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "no-comments", specifier: "eslint-plugin-no-comments" },
    ],
    options: {
      denyWarnings: true,
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ["**/*.ts"],
        rules: {
          "import/extensions": ["error", "ignorePackages", { checkTypeImports: true, js: "never" }],
        },
      },
    ],
    plugins: lintPlugins,
    rules: {
      "eslint/no-control-regex": "error",
      "eslint/no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "eslint/no-restricted-imports": ["error", restrictedImports],
      "eslint/no-restricted-properties": [
        "error",
        {
          message: "node の組み込みは Effect の platform 経由で使う",
          object: "process",
          property: "getBuiltinModule",
        },
      ],
      "eslint/no-shadow": "error",
      "eslint/no-undef": "error",
      "eslint/no-underscore-dangle": "error",
      "eslint/no-unmodified-loop-condition": "error",
      "eslint/one-var": ["error", "never"],
      "eslint/sort-imports": ["error", { ignoreDeclarationSort: true }],
      "eslint/sort-keys": "error",
      "import/no-named-export": "error",
      "import/prefer-default-export": "error",
      "no-comments/disallowComments": ["error", { allow: ["oxlint-disable", "eslint-disable"] }],
      "node/no-top-level-await": "error",
      "promise/always-return": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
      ...asErrors(strictCategoryRules),
      ...effectRules,
    },
  },
  run: {
    tasks: {
      "actions-lint": {
        cache: {
          env: ["CLAUDE_CODE_REMOTE"],
          untrackedEnv: [
            "GH_TOKEN",
            "HTTPS_PROXY",
            "https_proxy",
            "NO_PROXY",
            "no_proxy",
            "SSL_CERT_FILE",
          ],
        },
        command:
          'uvx --from actionlint-py@1.7.12.25 actionlint && uvx zizmor@1.30.1 $(test -n "$CLAUDE_CODE_REMOTE" && echo --no-online-audits) .github && ast-grep scan --rule .github/rules/no-full-history-checkout.yml .github/workflows',
      },
      audit: {
        cache: false,
        command: "vp pm audit",
      },
      "build-binaries": {
        cache: false,
        command: "node tools/build-binaries.ts",
      },
      "daemon-build": {
        cache: false,
        command: "vp run --filter @msa/env build:daemon",
      },
      "fallow-all": "vp run -r fallow",
      gitleaks: {
        cache: false,
        command:
          'go run github.com/zricethezav/gitleaks/v8@v8.30.1 git --redact --no-banner --log-opts="$(git rev-parse -q --verify "$GITLEAKS_BASE" || echo origin/main)..HEAD"',
      },
      "install-local": {
        cache: false,
        command: "node tools/local-install.ts",
      },
      "mcp-conformance": {
        cache: false,
        command: "node apps/coding-agent/test/mcp-conformance/run.ts",
      },
      "render-homebrew-formula": {
        cache: false,
        command: "node tools/render-homebrew-formula.ts",
      },
      syncpack: "syncpack lint",
      test: {
        cache: false,
        command: "vp test run && vp run --no-cache --filter @msa/tui test",
      },
      "test-all": {
        cache: false,
        command: "bash test.sh",
        dependsOn: ["build", "daemon-build"],
      },
      verify: {
        command: "vp check",
        dependsOn: [
          "syncpack",
          "actions-lint",
          "mcp-conformance",
          "fallow-all",
          "audit",
          "test-all",
        ],
      },
    },
  },
  staged: { "*": "vp check --fix" },
  test: {
    projects: [
      "{apps,libs}/*/vitest.config.ts",
      "apps/evals/vitest.test.config.ts",
      "libs/chord",
      "libs/telemetry",
      "tools/vitest.config.ts",
    ],
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
  },
});
