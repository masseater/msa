const EFFECT_ONLY_UTILS = "検証、日時、ログ、関数型ユーティリティは Effect だけで扱う";
const EFFECT_ONLY_HTTP = "HTTP クライアントは Effect だけで扱う";
const EFFECT_ONLY_TRACING = "計装は Effect のトレーシングだけで扱う";

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
    .map(({ message, module }) => ({ name: module, message }));

const requiredStackPatterns: readonly Readonly<{ group: readonly string[]; message: string }>[] =
  requiredStackEntries.map(({ message, module }) => {
    if (module.includes("*")) {
      return { group: [module, `${module}/**`], message };
    }
    return { group: [`${module}/**`], message };
  });

const restrictedImports = {
  paths: [...requiredStackPaths],
  patterns: [...requiredStackPatterns],
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

export { generated, requiredStack, restrictedImports, strictCategoryRules };
