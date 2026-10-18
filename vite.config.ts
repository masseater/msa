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

const effectRulesPendingMigration = new Set([
  "effecttsgo/async-function",
  "effecttsgo/crypto-random-uuid",
  "effecttsgo/extends-native-error",
  "effecttsgo/global-console",
  "effecttsgo/global-date",
  "effecttsgo/global-fetch",
  "effecttsgo/global-random",
  "effecttsgo/global-timers",
  "effecttsgo/missing-pipeable-signature",
  "effecttsgo/new-promise",
  "effecttsgo/node-builtin-import",
  "effecttsgo/process-env",
  "effecttsgo/strict-boolean-expressions",
  "effecttsgo/unnecessary-arrow-block",
  "effecttsgo/unnecessary-pipe-chain",
]);

const effectRules = asErrors(effectRuleNames);
const landedEffectRules = asErrors(
  effectRuleNames.filter((name) => !effectRulesPendingMigration.has(name)),
);

export const workspaceSourcePaths = {
  chordIndex: fileURLToPath(new URL("./libs/chord/src/index.ts", import.meta.url)),
  chordContext: fileURLToPath(new URL("./libs/chord/src/context/index.ts", import.meta.url)),
  chordDelta: fileURLToPath(new URL("./libs/chord/src/delta/index.ts", import.meta.url)),
  chordNode: fileURLToPath(new URL("./libs/chord/src/node.ts", import.meta.url)),
  telemetryIndex: fileURLToPath(new URL("./libs/telemetry/src/index.ts", import.meta.url)),
  telemetryTesting: fileURLToPath(
    new URL("./libs/telemetry/src/testing/index.ts", import.meta.url),
  ),
  mcpIndex: fileURLToPath(new URL("./libs/mcp/src/index.ts", import.meta.url)),
  mcpOAuth: fileURLToPath(new URL("./libs/mcp/src/oauth/index.ts", import.meta.url)),
  mcpTesting: fileURLToPath(new URL("./libs/mcp/src/testing/index.ts", import.meta.url)),
  aiIndex: fileURLToPath(new URL("./libs/ai/src/index.ts", import.meta.url)),
  aiCompat: fileURLToPath(new URL("./libs/ai/src/compat.ts", import.meta.url)),
  aiOAuth: fileURLToPath(new URL("./libs/ai/src/oauth.ts", import.meta.url)),
  aiApi: fileURLToPath(new URL("./libs/ai/src/api", import.meta.url)),
  aiProviders: fileURLToPath(new URL("./libs/ai/src/providers", import.meta.url)),
  aiUtils: fileURLToPath(new URL("./libs/ai/src/utils", import.meta.url)),
  agentIndex: fileURLToPath(new URL("./libs/agent/src/index.ts", import.meta.url)),
  codemodeIndex: fileURLToPath(new URL("./libs/codemode/src/index.ts", import.meta.url)),
  codemodeDeclarations: fileURLToPath(
    new URL("./libs/codemode/src/declarations.ts", import.meta.url),
  ),
  codemodeSource: fileURLToPath(new URL("./libs/codemode/src/source.ts", import.meta.url)),
  codingAgentIndex: fileURLToPath(new URL("./apps/coding-agent/src/index.ts", import.meta.url)),
  tuiIndex: fileURLToPath(new URL("./libs/tui/src/index.ts", import.meta.url)),
  testingIndex: fileURLToPath(new URL("./libs/testing/src/index.ts", import.meta.url)),
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
  test: {
    projects: [
      "{apps,libs}/*/vitest.config.ts",
      "apps/evals/vitest.test.config.ts",
      "libs/chord",
      "libs/telemetry",
    ],
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
  },
  staged: { "*": "vp check --fix" },
  fmt: {
    ignorePatterns: generated,
    sortImports: true,
    sortPackageJson: true,
  },
  lint: {
    ignorePatterns: [
      ...generated,
      "apps/coding-agent/examples/extensions/gondolin/**",
      "libs/codemode/examples/**",
    ],
    plugins: lintPlugins,
    categories: {
      correctness: "error",
      suspicious: "error",
    },
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "no-comments", specifier: "eslint-plugin-no-comments" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "eslint/no-control-regex": "off",
      "eslint/no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "eslint/no-restricted-imports": ["error", restrictedImports],
      "eslint/no-undef": "off",
      "eslint/no-underscore-dangle": "off",
      "eslint/no-unmodified-loop-condition": "off",
      "eslint/one-var": ["error", "never"],
      "eslint/sort-imports": "off",
      "eslint/sort-keys": "off",
      "import/no-named-export": "off",
      "import/prefer-default-export": "off",
      "node/no-top-level-await": "off",
      "promise/always-return": "off",
      ...landedEffectRules,
    },
    overrides: [
      {
        files: ["**/test/**", "**/*.test.ts", "**/*.spec.ts", "**/*.bench.ts"],
        rules: {
          "eslint/no-shadow": "off",
          "eslint/max-lines-per-function": "off",
        },
      },
      {
        files: ["tools/**", "lint.config.ts", "syncpack.config.ts", "vite.config.ts"],
        rules: {
          "no-comments/disallowComments": [
            "error",
            { allow: ["oxlint-disable", "eslint-disable"] },
          ],
          "eslint/no-control-regex": "error",
          "eslint/no-shadow": "error",
          "eslint/no-underscore-dangle": "error",
          "eslint/no-unmodified-loop-condition": "error",
          "promise/always-return": "error",
          ...asErrors(strictCategoryRules),
          ...effectRules,
        },
      },
      {
        files: [
          "apps/coding-agent/test/mcp-extension.test.ts",
          "apps/coding-agent/test/mcp-oauth-refresh.test.ts",
          "apps/coding-agent/test/memory.test.ts",
          "apps/coding-agent/test/model-registry.test.ts",
          "apps/coding-agent/test/nested-tool-calls.test.ts",
          "apps/coding-agent/test/orchestrator.test.ts",
          "apps/coding-agent/test/package-manager.test.ts",
          "apps/coding-agent/test/prompt-templates.test.ts",
          "apps/coding-agent/test/remote-catalog-provider.test.ts",
          "apps/coding-agent/test/resource-loader.test.ts",
          "apps/coding-agent/test/sdk-codex-cache-probe-tool-loop.ts",
          "apps/coding-agent/test/sdk-stream-options.test.ts",
          "apps/coding-agent/test/session-context-edit.test.ts",
          "apps/coding-agent/test/session-selector-path-delete.test.ts",
          "apps/coding-agent/test/skills.test.ts",
          "apps/coding-agent/test/system-prompt-updates.test.ts",
          "apps/coding-agent/test/test-harness.test.ts",
          "apps/coding-agent/test/tree-selector.test.ts",
          "apps/coding-agent/test/virtual-models.test.ts",
          "apps/coding-agent/test/web-tools.test.ts",
          "apps/coding-agent/test/orchestrator-sdk.test.ts",
          "apps/coding-agent/test/output-pad.test.ts",
          "apps/coding-agent/test/read-line-range-display.test.ts",
          "apps/coding-agent/test/session-id-readonly.test.ts",
          "apps/coding-agent/test/sessions-view.test.ts",
          "apps/coding-agent/test/utilities.ts",
          "vite.config.ts",
        ],
        rules: {
          "eslint/max-lines": "off",
          "import/max-dependencies": "off",
        },
      },
      {
        files: [
          "apps/coding-agent/test/mcp-extension.test.ts",
          "apps/coding-agent/test/mcp-oauth-refresh.test.ts",
          "apps/coding-agent/test/memory.test.ts",
          "apps/coding-agent/test/models-store.test.ts",
          "apps/coding-agent/test/package-manager.test.ts",
          "apps/coding-agent/test/prompt-templates.test.ts",
          "apps/coding-agent/test/resource-loader.test.ts",
          "apps/coding-agent/test/session-file-invalid.test.ts",
          "apps/coding-agent/test/session-id-readonly.test.ts",
          "apps/coding-agent/test/session-info-modified-timestamp.test.ts",
          "apps/coding-agent/test/session-share.test.ts",
          "apps/coding-agent/test/startup-session-name.test.ts",
          "apps/coding-agent/test/stdout-cleanliness.test.ts",
          "apps/coding-agent/test/utilities.ts",
          "apps/coding-agent/test/web-tools.test.ts",
        ],
        rules: {
          "effecttsgo/node-builtin-import": "off",
          "effecttsgo/new-promise": "off",
          "effecttsgo/global-timers": "off",
          "effecttsgo/global-fetch": "off",
          "effecttsgo/prefer-schema-over-json": "off",
          "eslint/no-promise-executor-return": "off",
        },
      },
      {
        files: [
          "apps/coding-agent/test/rpc-example.ts",
          "apps/coding-agent/test/sdk-codex-cache-probe-tool-loop.ts",
          "apps/coding-agent/test/streaming-render-debug.ts",
          "apps/coding-agent/test/test-theme-colors.ts",
        ],
        rules: {
          "no-comments/disallowComments": "off",
          "eslint/no-inline-comments": "off",
          "eslint/no-underscore-dangle": "off",
          "eslint/no-lonely-if": "off",
          "eslint/no-fallthrough": "off",
          "eslint/require-await": "off",
          "eslint/no-await-in-loop": "off",
          "eslint/require-unicode-regexp": "off",
          "eslint/max-lines": "off",
          "import/max-dependencies": "off",
          "effecttsgo/async-function": "off",
          "effecttsgo/global-console": "off",
          "effecttsgo/global-date": "off",
          "effecttsgo/global-timers": "off",
          "effecttsgo/new-promise": "off",
          "effecttsgo/node-builtin-import": "off",
          "effecttsgo/process-env": "off",
          "effecttsgo/strict-boolean-expressions": "off",
          "eslint/no-promise-executor-return": "off",
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
      denyWarnings: true,
      reportUnusedDisableDirectives: "error",
    },
  },
  run: {
    tasks: {
      verify: {
        command: "vp check",
        dependsOn: [
          "engine-checks",
          "workspace-layout",
          "lint-categories",
          "syncpack",
          "actions-lint",
          "mcp-conformance",
          "fallow-all",
          "audit",
          "test-all",
        ],
      },
      "engine-checks": {
        command:
          "node scripts/check-ts-relative-imports.ts && node scripts/check-entry-graphs.ts && node scripts/check-browser-smoke.ts",
      },
      "workspace-layout": "node tools/workspace-layout.ts",
      "lint-categories": "node tools/lint-categories.ts",
      "actions-lint": {
        command:
          'uvx --from actionlint-py@1.7.12.25 actionlint && uvx zizmor@1.30.1 $(test -n "$CLAUDE_CODE_REMOTE" && echo --no-online-audits) .github && ast-grep scan --rule .github/rules/no-full-history-checkout.yml .github/workflows',
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
      },
      "mcp-conformance": {
        command: "node apps/coding-agent/test/mcp-conformance/run.ts",
        cache: false,
      },
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
        command: "vp run --filter @msa/env build:daemon",
        cache: false,
      },
      "build-binaries": {
        command: "node tools/build-binaries.ts",
        cache: false,
      },
      "install-local": {
        command: "node tools/local-install.ts",
        cache: false,
      },
      "render-homebrew-formula": {
        command: "node tools/render-homebrew-formula.ts",
        cache: false,
      },
      test: {
        command:
          "vp run --no-cache test:scripts && vp test run && vp run --no-cache --filter @msa/tui test",
        cache: false,
      },
      "test-all": {
        command: "bash test.sh",
        cache: false,
        dependsOn: ["build", "daemon-build", "engine-checks"],
      },
    },
  },
});
