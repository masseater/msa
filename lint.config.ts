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
  "packages/ai/src/providers/data/**",
  "packages/coding-agent/src/core/export-html/template.css",
  "packages/coding-agent/src/core/export-html/template.html",
  "packages/coding-agent/src/core/export-html/template.js",
  "packages/coding-agent/src/core/export-html/vendor/**",
  "packages/coding-agent/examples/extensions/doom-overlay/doom/build/**",
  "pnpm-lock.yaml",
];

const engine = ["packages/**", "scripts/**", ".pi/**"];

export { engine, generated, requiredStack, restrictedImports };
