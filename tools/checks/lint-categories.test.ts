import { Effect, ManagedRuntime, Schema } from "effect";
import { expect, it } from "vite-plus/test";

import {
  lintPlugins,
  strictCategories,
  strictCategoryExclusions,
  strictCategoryRules,
} from "../../lint.config.ts";
import { captureProcess, processRunnerLayer } from "../capture-process.ts";

const RuleList = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({ scope: Schema.String, value: Schema.String, category: Schema.String }),
  ),
);

const scopes = new Set(["eslint", ...lintPlugins]);

const isStrictCategoryRule = (rule: { scope: string; category: string }): boolean =>
  scopes.has(rule.scope) && strictCategories.includes(rule.category);

const listedRules = Effect.gen(function* () {
  const { stdout } = yield* captureProcess({
    args: ["lint", "--rules", "--format=json"],
    command: "vp",
    cwd: `${import.meta.dirname}/../..`,
  });
  return (yield* Schema.decodeEffect(RuleList)(stdout))
    .filter(isStrictCategoryRule)
    .map((rule) => `${rule.scope}/${rule.value}`)
    .filter((name) => !strictCategoryExclusions.includes(name));
});

const drift = Effect.gen(function* () {
  const expected = yield* listedRules;
  const listed = new Set(strictCategoryRules);
  return {
    missing: expected.filter((name) => !listed.has(name)),
    stale: strictCategoryRules.filter((name) => !expected.includes(name)),
  };
});

const runtime = ManagedRuntime.make(processRunnerLayer);

const checkDrift = drift.pipe(
  Effect.tap(({ missing, stale }) =>
    Effect.sync(() => {
      expect(missing).toEqual([]);
      expect(stale).toEqual([]);
    }),
  ),
);

it("lists every perf/pedantic/nursery rule that vp lint enables", () =>
  runtime.runPromise(checkDrift));
