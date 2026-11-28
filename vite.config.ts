import { betterleaks } from "@r_masseater/h56m/presets";
import { defineConfig } from "vite-plus";

import fallow from "./fallow.config.ts";
import lintConfig from "./lint.config.ts";
import localTimeRules from "./local-time-rules.config.ts";
import runConfig from "./run.config.ts";
import scriptIoRules from "./script-io-rules.config.ts";
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
  processEnvWriter,
  requiredStack,
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
  commitlint: {
    extends: ["@commitlint/config-conventional"],
    rules: { "subject-case": [0] as const },
  },
  dependencyRules: { banned: requiredStack },
  fallow,
  fmt: {
    ignorePatterns: generated,
    sortImports: true,
    sortPackageJson: true,
  },
  h56m: {
    extend: { path: betterleaks },
    filter: 'matchesAny(finding.line, [`\\bCF_BEACON_TOKEN = "[0-9a-f]{32}"`])',
    ignoredSecrets: [
      "7d811269d13fd7df0fd2cb573cbd1b11679a1ae347c179b3daf22b12408604c4",
      "efcf30858a13f54daacabfb6324aee1d5e595756e930bedcc3e3edcdbe9a940a",
      "f2b3b47fd9a71add893f496f8441de86cf6b2a76d87d224a9ad0431601fa9c22",
    ],
  },
  lint: {
    categories: {
      correctness: "error",
      suspicious: "error",
    },
    env: { builtin: true, node: true },
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
          "msa/no-builtin-require": ["error", { modules: builtinModuleBases }],
          "msa/no-local-class-extends": [
            "error",
            { builtins: builtinModuleBases, packages: workspacePackages, probeRoot: lintProbeDir },
          ],
          "msa/no-nested-class": "error",
          "msa/no-prototype-write": "error",
          "msa/node-builtins-via-platform": "error",
        },
      },
      {
        files: withProbes([
          "libs/durable/src/env/node/**",
          "apps/coding-agent/src/core/platform/node/**",
        ]),
        rules: {
          "effecttsgo/node-builtin-import": "off",
          "msa/no-builtin-require": "off",
          "msa/no-sync-fs": "off",
          "msa/node-builtins-via-platform": "off",
        },
      },
      {
        files: withProbes([processEnvWriter]),
        rules: { "effecttsgo/process-env": "off", "msa/process-env-writer": "error" },
      },
      {
        files: withProbes([localTimeRules.owners.dateGetters]),
        rules: { "msa/local-time-via-chord": "off" },
      },
      {
        files: withProbes([localTimeRules.owners.localZone]),
        rules: { "msa/no-restricted-member": ["error", { members: loopbackTestServerMembers }] },
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
        files: withProbes(["tools/oxlint/**"]),
        rules: { "msa/no-builtin-module-lookup": "off" },
      },
      {
        files: withProbes(["lint.config.ts"]),
        rules: { "msa/no-sync-fs": "off" },
      },
      {
        files: withProbes(scriptIoRules.files),
        rules: {
          "eslint/no-restricted-globals": ["error", ...scriptIoRules.globals],
          "msa/script-io-via-script-output": "error",
        },
      },
      {
        files: withProbes([scriptIoRules.testProcessOwner]),
        rules: {
          "msa/script-io-via-script-output": [
            "error",
            { allowed: scriptIoRules.testProcessModules },
          ],
        },
      },
      {
        files: withProbes(scriptIoRules.testFiles),
        rules: { "msa/script-io-via-script-output": "off" },
      },
      {
        files: withProbes(["bin/**"]),
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
      "eslint/no-script-url": "error",
      "eslint/no-shadow": "error",
      "eslint/no-undef": "error",
      "eslint/no-underscore-dangle": "error",
      "eslint/no-unmodified-loop-condition": "error",
      "eslint/one-var": ["error", "never"],
      "eslint/sort-imports": ["error", { ignoreDeclarationSort: true }],
      "eslint/sort-keys": "error",
      "import/no-named-export": "error",
      "import/prefer-default-export": "error",
      "msa/env-via-platform": "error",
      "msa/local-time-via-chord": "error",
      "msa/no-builtin-module-lookup": "error",
      "msa/no-builtin-require": ["error", { modules: effectReplaceableBuiltins }],
      "msa/no-restricted-member": [
        "error",
        { members: [...loopbackTestServerMembers, ...localTimeRules.zoneMembers] },
      ],
      "msa/no-sync-fs": ["error", { names: fsSyncFunctions }],
      "msa/timers-armed-by-the-run": "error",
      "no-comments/disallowComments": "error",
      "node/no-top-level-await": "error",
      "promise/always-return": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
      ...asErrors(strictCategoryRules),
      ...asErrors(adoptedEffectRules),
    },
  },
  run: runConfig.run,
  skills: {
    "masseater/skills": {
      commit: "c4b729ff64af66a7dffc2506091df802b7cd366c",
      root: "plugins/masseater-skills/skills",
      skills: "all",
    },
  },
  staged: { "*": "vp check --fix" },
  test: {
    passWithNoTests: testShard !== undefined,
    projects: ["{apps,libs}/*/vitest.config.ts", "tools/vitest.config.ts"],
    reporters: onGitHubActions ? ["dot", "github-actions"] : ["dot"],
    shard: testShard,
  },
});
