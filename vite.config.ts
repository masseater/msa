import { presets as effectPresets } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "vite-plus";

import lintConfig from "./lint.config.ts";
import vitestShared from "./vitest.shared.ts";

const {
  builtinModuleBases,
  effectReplaceableBuiltins,
  fsSyncFunctions,
  generated,
  lintPlugins,
  loopbackTestServerMembers,
  platformOnlyImports,
  restrictedImports,
  restrictedProperties,
  strictCategoryRules,
  workspacePackages,
} = lintConfig;
const { onGitHubActions } = vitestShared;

type Rules = Readonly<Record<string, "error">>;

const asErrors = (names: readonly string[]): Rules =>
  Object.fromEntries(names.map((name) => [name, "error"] as const));

const effectRuleNames = Object.values(effectPresets).flatMap((preset) =>
  Object.keys(preset.rules ?? {}),
);

const effectRules = asErrors(effectRuleNames);

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
      { name: "msa", specifier: "./tools/oxlint/msa-plugin.ts" },
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
      {
        files: ["apps/coding-agent/src/**"],
        rules: {
          "eslint/no-restricted-imports": ["error", platformOnlyImports],
          "msa/no-builtin-require": ["error", { modules: builtinModuleBases }],
          "msa/no-local-class-extends": ["error", { packages: workspacePackages }],
        },
      },
      {
        files: ["libs/durable/src/env/node/**", "apps/coding-agent/src/core/platform/node/**"],
        rules: {
          "effecttsgo/node-builtin-import": "off",
          "eslint/no-restricted-imports": ["error", restrictedImports],
          "msa/no-builtin-require": "off",
          "msa/no-sync-fs": "off",
        },
      },
      {
        files: ["tools/oxlint/**"],
        rules: { "msa/no-builtin-module-lookup": "off" },
      },
      {
        files: ["lint.config.ts"],
        rules: { "msa/no-sync-fs": "off" },
      },
      {
        files: ["scripts/**"],
        rules: { "import/max-dependencies": ["error", { ignoreTypeImports: true, max: 10 }] },
      },
      {
        files: ["libs/*/test/**"],
        rules: { "import/max-dependencies": ["error", { max: 15 }] },
      },
      {
        files: ["**/*.types.ts"],
        rules: { "eslint/max-lines": ["error", { max: 400 }] },
      },
    ],
    plugins: lintPlugins,
    rules: {
      "eslint/no-control-regex": "error",
      "eslint/no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "eslint/no-restricted-imports": ["error", restrictedImports],
      "eslint/no-restricted-properties": ["error", ...restrictedProperties],
      "eslint/no-shadow": "error",
      "eslint/no-undef": "error",
      "eslint/no-underscore-dangle": "error",
      "eslint/no-unmodified-loop-condition": "error",
      "eslint/one-var": ["error", "never"],
      "eslint/sort-imports": ["error", { ignoreDeclarationSort: true }],
      "eslint/sort-keys": "error",
      "import/no-named-export": "error",
      "import/prefer-default-export": "error",
      "msa/no-builtin-module-lookup": "error",
      "msa/no-builtin-require": ["error", { modules: effectReplaceableBuiltins }],
      "msa/no-restricted-member": ["error", { members: loopbackTestServerMembers }],
      "msa/no-sync-fs": ["error", { names: fsSyncFunctions }],
      "no-comments/disallowComments": "error",
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
      "code-rules": {
        command:
          "ast-grep scan --rule tools/rules/no-sync-run-of-async-fs.yml apps libs tools .msa",
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
      "lockfile-policy": {
        cache: false,
        command:
          "git ls-files -- ':(glob)**/package-lock.json' ':(glob)**/npm-shrinkwrap.json' ':(glob)**/yarn.lock' ':(glob)**/bun.lock' ':(glob)**/bun.lockb' ':(glob)**/deno.lock' | awk '{ print \"pnpm-lock.yaml 以外の lock がコミットされている: \" $0; found = 1 } END { exit found }'",
      },
      "mcp-conformance": {
        cache: false,
        command: "vp run test:mcp-conformance",
      },
      "render-homebrew-formula": {
        cache: false,
        command: "node tools/render-homebrew-formula.ts",
      },
      "smoke-binary-decide": {
        cache: false,
        command: "node tools/smoke-binary-decide.ts",
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
          "code-rules",
          "lockfile-policy",
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
