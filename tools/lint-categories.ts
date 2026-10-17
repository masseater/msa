import { Console, Data, Effect, ManagedRuntime, Schema } from "effect";

import {
  lintPlugins,
  strictCategories,
  strictCategoryExclusions,
  strictCategoryRules,
} from "../lint.config.ts";
import { captureProcess, processRunnerLayer } from "./capture-process.ts";

const RuleList = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({ scope: Schema.String, value: Schema.String, category: Schema.String }),
  ),
);

class CategoryDrift extends Data.TaggedError("CategoryDrift")<{ readonly message: string }> {}

const scopes = new Set(["eslint", ...lintPlugins]);

const isStrictCategoryRule = (rule: { scope: string; category: string }): boolean =>
  scopes.has(rule.scope) && strictCategories.includes(rule.category);

const listOrDash = (names: readonly string[]): string => names.join(", ") || "-";

const program = Effect.gen(function* () {
  const { stdout } = yield* captureProcess({
    args: ["lint", "--rules", "--format=json"],
    command: "vp",
    cwd: `${import.meta.dirname}/..`,
  });
  const expected = (yield* Schema.decodeEffect(RuleList)(stdout))
    .filter(isStrictCategoryRule)
    .map((rule) => `${rule.scope}/${rule.value}`)
    .filter((name) => !strictCategoryExclusions.includes(name));
  const listed = new Set(strictCategoryRules);
  const missing = expected.filter((name) => !listed.has(name));
  const stale = strictCategoryRules.filter((name) => !expected.includes(name));
  if (missing.length + stale.length > 0) {
    return yield* new CategoryDrift({
      message: `strictCategoryRules in lint.config.ts drifted from \`vp lint --rules\` (${strictCategories.join(", ")}):\n  missing: ${listOrDash(missing)}\n  stale: ${listOrDash(stale)}`,
    });
  }
  yield* Console.log(
    `strictCategoryRules matches ${expected.length} ${strictCategories.join("/")} rules`,
  );
});

await ManagedRuntime.make(processRunnerLayer).runPromise(program);
