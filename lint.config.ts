import { builtinModules } from "node:module";

import type { OxlintConfig } from "vite-plus/lint";

import lintedPackages from "./tools/oxlint/workspace-packages.json" with { type: "json" };

const EFFECT_ONLY_UTILS = "検証、日時、ログ、関数型ユーティリティは Effect だけで扱う";
const EFFECT_ONLY_HTTP = "HTTP クライアントは Effect だけで扱う";
const EFFECT_ONLY_TRACING = "計装は Effect のトレーシングだけで扱う";
const ENV_ONLY_VIA_PROCESS_ENV =
  "環境変数は core/platform の readEnv・writeEnv・envSnapshot だけで扱う";
const TIMERS_ARMED_BY_THE_RUN =
  "タイマーはプロセス全体で数えず、@msa/testing の timersArmedBy で計測する処理が張ったものだけを数える";
const LOOPBACK_TEST_SERVER =
  "テスト用の HTTP サーバーは @msa/testing の listen・serveLoopback で 127.0.0.1 に立てる";

const requiredStack: Readonly<Record<string, readonly string[]>> = {
  [EFFECT_ONLY_UTILS]: [
    "zod",
    "yup",
    "joi",
    "valibot",
    "arktype",
    "io-ts",
    "superstruct",
    "moment",
    "dayjs",
    "date-fns",
    "luxon",
    "winston",
    "pino",
    "bunyan",
    "loglevel",
    "lodash",
    "lodash-es",
    "ramda",
    "rxjs",
    "fp-ts",
    "neverthrow",
    "ts-results",
    "purify-ts",
  ],
  [EFFECT_ONLY_HTTP]: ["axios", "ky", "ofetch", "got", "node-fetch"],
  [EFFECT_ONLY_TRACING]: ["@opentelemetry/*", "dd-trace", "newrelic"],
};

const requiredStackEntries = Object.entries(requiredStack).flatMap(([message, modules]) =>
  modules.map((module) => ({ message, module })),
);

const requiredStackPaths: readonly Readonly<{ name: string; message: string }>[] =
  requiredStackEntries
    .filter(({ module }) => !module.includes("*"))
    .map(({ message, module }) => ({ message, name: module }));

const requiredStackPatterns: readonly Readonly<{ group: readonly string[]; message: string }>[] =
  requiredStackEntries.map(({ message, module }) => {
    if (module.includes("*")) {
      return { group: [module, `${module}/**`], message };
    }
    return { group: [`${module}/**`], message };
  });

const envImportPaths: readonly Readonly<{
  name: string;
  importNames: readonly string[];
  message: string;
}>[] = [
  { importNames: ["env"], message: ENV_ONLY_VIA_PROCESS_ENV, name: "node:process" },
  { importNames: ["env"], message: ENV_ONLY_VIA_PROCESS_ENV, name: "process" },
];

const loopbackTestServerMembers: readonly Readonly<{
  module: string;
  path: readonly string[];
  message: string;
}>[] = [
  {
    message: LOOPBACK_TEST_SERVER,
    module: "@effect/platform-node",
    path: ["NodeHttpServer", "layerTest"],
  },
  {
    message: LOOPBACK_TEST_SERVER,
    module: "@effect/platform-node/NodeHttpServer",
    path: ["layerTest"],
  },
];

const restrictedProperties: readonly Readonly<{ property: string; message: string }>[] = [
  { message: TIMERS_ARMED_BY_THE_RUN, property: "getActiveResourcesInfo" },
];

const restrictedImports = {
  paths: [...requiredStackPaths, ...envImportPaths],
  patterns: [...requiredStackPatterns],
};

const NODE_BUILTINS_VIA_PLATFORM = "node の組み込みは core/platform/node/ を通して使う";

const effectReplaceableBuiltins: readonly string[] = [
  "child_process",
  "console",
  "crypto",
  "fs",
  "http",
  "https",
  "path",
  "stream",
  "timers",
];

const fsSyncFunctions: readonly string[] = [
  "accessSync",
  "appendFileSync",
  "chmodSync",
  "chownSync",
  "closeSync",
  "copyFileSync",
  "cpSync",
  "existsSync",
  "fchmodSync",
  "fchownSync",
  "fdatasyncSync",
  "fstatSync",
  "fsyncSync",
  "ftruncateSync",
  "futimesSync",
  "globSync",
  "lchmodSync",
  "lchownSync",
  "linkSync",
  "lstatSync",
  "lutimesSync",
  "mkdirSync",
  "mkdtempDisposableSync",
  "mkdtempSync",
  "openAsBlobSync",
  "openSync",
  "opendirSync",
  "readFileSync",
  "readSync",
  "readdirSync",
  "readlinkSync",
  "readvSync",
  "realpathSync",
  "renameSync",
  "rmSync",
  "rmdirSync",
  "statSync",
  "statfsSync",
  "symlinkSync",
  "truncateSync",
  "unlinkSync",
  "utimesSync",
  "writeFileSync",
  "writeSync",
  "writevSync",
];

const builtinModuleBases: readonly string[] = [
  ...new Set(builtinModules.map((name) => name.replace(/^node:/u, "").split("/")[0] ?? name)),
];

const platformOnlyImports = {
  paths: [
    ...restrictedImports.paths,
    ...builtinModules.map((name) => ({ message: NODE_BUILTINS_VIA_PLATFORM, name })),
  ],
  patterns: [
    ...restrictedImports.patterns,
    { group: ["node:*", "node:*/**"], message: NODE_BUILTINS_VIA_PLATFORM },
  ],
};

const generated = [
  "**/dist/**",
  "**/models.generated.ts",
  "**/*.models.ts",
  "libs/ai/src/providers/data/**",
  "apps/coding-agent/src/core/export-html/template.css",
  "apps/coding-agent/src/core/export-html/template.html",
  "apps/coding-agent/src/core/export-html/template.js",
  "apps/coding-agent/src/core/export-html/vendor/**",
  "apps/coding-agent/examples/extensions/doom-overlay/doom/build/**",
  "pnpm-lock.yaml",
];

const lintPlugins: NonNullable<OxlintConfig["plugins"]> = [
  "oxc",
  "import",
  "promise",
  "node",
  "jsdoc",
  "effecttsgo",
];
const strictCategories = ["perf", "pedantic", "nursery"];

const strictCategoryRules = [
  "eslint/accessor-pairs",
  "eslint/array-callback-return",
  "eslint/eqeqeq",
  "eslint/max-classes-per-file",
  "eslint/max-depth",
  "eslint/max-lines",
  "eslint/max-lines-per-function",
  "eslint/max-nested-callbacks",
  "eslint/no-array-constructor",
  "eslint/no-await-in-loop",
  "eslint/no-case-declarations",
  "eslint/no-constructor-return",
  "eslint/no-else-return",
  "eslint/no-fallthrough",
  "eslint/no-inline-comments",
  "eslint/no-inner-declarations",
  "eslint/no-lonely-if",
  "eslint/no-loop-func",
  "eslint/no-negated-condition",
  "eslint/no-new-wrappers",
  "eslint/no-object-constructor",
  "eslint/no-promise-executor-return",
  "eslint/no-prototype-builtins",
  "eslint/no-redeclare",
  "eslint/no-restricted-exports",
  "eslint/no-self-compare",
  "eslint/no-throw-literal",
  "eslint/no-undef",
  "eslint/no-unreachable-loop",
  "eslint/no-useless-assignment",
  "eslint/no-useless-call",
  "eslint/no-useless-return",
  "eslint/no-warning-comments",
  "eslint/prefer-promise-reject-errors",
  "eslint/radix",
  "eslint/require-await",
  "eslint/require-unicode-regexp",
  "eslint/sort-vars",
  "eslint/symbol-description",
  "import/export",
  "import/max-dependencies",
  "import/named",
  "jsdoc/require-param",
  "jsdoc/require-param-description",
  "jsdoc/require-param-name",
  "jsdoc/require-param-type",
  "jsdoc/require-returns",
  "jsdoc/require-returns-description",
  "jsdoc/require-returns-type",
  "jsdoc/require-throws-type",
  "jsdoc/require-yields-type",
  "oxc/branches-sharing-code",
  "oxc/no-accumulating-spread",
  "oxc/no-map-spread",
  "promise/no-return-in-finally",
];

const workspacePackages = lintedPackages.map(({ dir, specifiers }) => ({
  dir: `${import.meta.dirname}/${dir}`,
  specifiers,
}));

const lintConfig = {
  builtinModuleBases,
  effectReplaceableBuiltins,
  fsSyncFunctions,
  generated,
  lintPlugins,
  loopbackTestServerMembers,
  platformOnlyImports,
  requiredStack,
  restrictedImports,
  restrictedProperties,
  strictCategories,
  strictCategoryRules,
  workspacePackages,
};

export default lintConfig;
