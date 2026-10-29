import { defineConfig } from "vite-plus";

import lintConfig from "./lint.config.ts";
import runConfig from "./run.config.ts";
import vitestShared from "./vitest.shared.ts";

const {
  adoptedEffectRules,
  builtinModuleBases,
  effectReplaceableBuiltins,
  fsSyncFunctions,
  generated,
  lintPlugins,
  lintProbeDir,
  lintProbeRoot,
  loopbackTestServerMembers,
  platformOnlyImports,
  processEnvWriter,
  restrictedImports,
  restrictedProperties,
  strictCategoryRules,
  workspacePackages,
} = lintConfig;
const { onGitHubActions, testShard } = vitestShared;

type Rules = Readonly<Record<string, "error">>;

const asErrors = (names: readonly string[]): Rules =>
  Object.fromEntries(names.map((name) => [name, "error"] as const));

const withProbes = (files: readonly string[]): string[] => [
  ...files,
  ...files.filter((file) => !file.startsWith("**/")).map((file) => `${lintProbeRoot}/*/${file}`),
];
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
        files: withProbes(["**/*.ts"]),
        rules: {
          "import/extensions": ["error", "ignorePackages", { checkTypeImports: true, js: "never" }],
        },
      },
      {
        files: withProbes(["apps/coding-agent/src/**"]),
        rules: {
          "eslint/no-restricted-imports": ["error", platformOnlyImports],
          "msa/no-builtin-require": ["error", { modules: builtinModuleBases }],
          "msa/no-local-class-extends": [
            "error",
            { builtins: builtinModuleBases, packages: workspacePackages, probeRoot: lintProbeDir },
          ],
          "msa/no-nested-class": "error",
          "msa/no-prototype-write": "error",
        },
      },
      {
        files: withProbes([
          "libs/durable/src/env/node/**",
          "apps/coding-agent/src/core/platform/node/**",
        ]),
        rules: {
          "effecttsgo/node-builtin-import": "off",
          "eslint/no-restricted-imports": ["error", restrictedImports],
          "msa/no-builtin-require": "off",
          "msa/no-sync-fs": "off",
        },
      },
      {
        files: withProbes([processEnvWriter]),
        rules: { "effecttsgo/process-env": "off", "msa/process-env-writer": "error" },
      },
      {
        files: ["apps/coding-agent/test/fixtures/class-seal/**"],
        rules: {
          "effecttsgo/error-payload-shadows-name": "off",
          "effecttsgo/prefer-schema-tagged-error": "off",
          "effecttsgo/schema-class-missing-brand": "off",
        },
      },
      {
        files: ["libs/agent/test/utils/calculate.ts", "libs/ai/test/validation.test.ts"],
        rules: { "eslint/no-new-func": "off" },
      },
      {
        files: withProbes(["apps/*/src/**/*.js", "scripts/**/*.js"]),
        rules: { "msa/no-prototype-write": "error" },
      },
      {
        files: ["apps/coding-agent/src/core/export-html/html-fragment.js"],
        rules: { "eslint/no-unused-vars": "off" },
      },
      {
        files: withProbes(["tools/oxlint/**"]),
        rules: { "msa/no-builtin-module-lookup": "off" },
      },
      {
        files: withProbes(["lint.config.ts"]),
        rules: { "msa/no-sync-fs": "off" },
      },
      {
        files: withProbes(["scripts/**"]),
        rules: { "import/max-dependencies": ["error", { ignoreTypeImports: true, max: 10 }] },
      },
      {
        files: withProbes(["libs/*/test/**"]),
        rules: { "import/max-dependencies": ["error", { max: 15 }] },
      },
      {
        files: withProbes(["**/*.types.ts"]),
        rules: { "eslint/max-lines": ["error", { max: 400 }] },
      },
    ],
    plugins: lintPlugins,
    rules: {
      "eslint/no-control-regex": "error",
      "eslint/no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "eslint/no-new-func": "error",
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
      ...asErrors(adoptedEffectRules),
    },
  },
  run: runConfig.run,
  staged: { "*": "vp check --fix" },
  test: {
    passWithNoTests: testShard !== undefined,
    projects: [
      "{apps,libs}/*/vitest.config.ts",
      "apps/evals/vitest.test.config.ts",
      "libs/chord",
      "libs/telemetry",
      "tools/vitest.config.ts",
    ],
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
    shard: testShard,
  },
});
