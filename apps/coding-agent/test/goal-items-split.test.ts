import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import goalItemsModule from "../src/core/orchestrator/goal-items.ts";

const { joinPath, readTextFile, runTest } = testing;
const { goalItems } = goalItemsModule;

const MARKERS_ONLY = /^(?:[-*+•・]|\d{1,3}[.)]|[(（]\d{1,2}[)）]|[①-⑳])*$/u;

const squash = (text: string) => text.replaceAll(/\s+/gu, "");

function uncovered(goalState: string, items: readonly string[]): string[] {
  const whole = squash(goalState);
  const gaps: string[] = [];
  let at = 0;
  for (const item of items) {
    const found = whole.indexOf(squash(item), at);
    if (found < 0) return [...gaps, `not in the goal state, in order: ${item}`];
    const gap = whole.slice(at, found);
    if (!MARKERS_ONLY.test(gap)) gaps.push(gap);
    at = found + squash(item).length;
  }
  const tail = whole.slice(at);
  return MARKERS_ONLY.test(tail) ? gaps : [...gaps, tail];
}

const CASES = [
  ["bullets.txt", 4, "PR の `commits` ジョブで"],
  ["inline-numbers.txt", 3, "issue を立てたうえで次が実装されている。"],
  ["list-between-sentences.txt", 6, "報告にこの 3 点をまとめ"],
  ["numbered-lines-with-nested-list.txt", 5, "- prefer-effect-array"],
  ["numbered-list-in-code.txt", 6, "(1) not an item"],
  ["prose.txt", 6, "理由はコミットログに書く。"],
] as const;

const splitsEveryRequirementIntoAnItem = (file: string, count: number, kept: string) =>
  runTest(
    Effect.gen(function* () {
      const goalState = yield* readTextFile(joinPath(__dirname, "fixtures/goal-states", file));
      const items = goalItems(goalState);
      expect(uncovered(goalState, items)).toStrictEqual([]);
      expect(items).toHaveLength(count);
      expect(items.filter((item) => item.includes(kept))).toHaveLength(1);
    }),
  );

it.each(CASES)(
  "puts every character of %s in one of %i goal items, the text around the list and inside code blocks included",
  splitsEveryRequirementIntoAnItem,
);

it("keeps a nested list and a reference to an item number inside the item they belong to", () => {
  const items = goalItems(
    [
      "(1) The worker starts in its own worktree (#168 (1)).",
      "  - The branch is cut from the latest main.",
      "(2) The checks run there. (2)(3) are covered by tests.",
    ].join("\n"),
  );
  expect(items).toStrictEqual([
    "The worker starts in its own worktree (#168 (1)).\n  - The branch is cut from the latest main.",
    "The checks run there. (2)(3) are covered by tests.",
  ]);
});
