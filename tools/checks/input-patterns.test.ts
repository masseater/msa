import { expect, it } from "vite-plus/test";

import inputPatterns from "./input-patterns.ts";

const { coverageOf } = inputPatterns;

const coveredBy = (patterns: ReadonlyArray<string>, files: ReadonlyArray<string>) => {
  const coverage = coverageOf(patterns);
  return "problem" in coverage ? coverage.problem : files.filter(coverage.covers);
};

const FILES = [
  "package.json",
  "libs/ai/src/index.ts",
  "libs/ai/node_modules/x/index.js",
  "libs/aim/src/index.ts",
  "apps/coding-agent/dist/cli.js",
  "tools/run-main.ts",
];

it.each([
  ["a directory tree", ["libs/ai/**"], ["libs/ai/src/index.ts", "libs/ai/node_modules/x/index.js"]],
  ["root files only", ["*"], ["package.json"]],
  ["a single file", ["tools/run-main.ts"], ["tools/run-main.ts"]],
  [
    "everything but a directory at any depth",
    ["**", "!**/node_modules/**", "!**/dist/**"],
    ["package.json", "libs/ai/src/index.ts", "libs/aim/src/index.ts", "tools/run-main.ts"],
  ],
  [
    "a tree without a file in it",
    ["libs/ai/**", "!libs/ai/src/index.ts"],
    ["libs/ai/node_modules/x/index.js"],
  ],
])("covers the files that %s matches", (_, patterns, covered) => {
  expect(coveredBy(patterns, FILES)).toEqual(covered);
});

it("refuses a pattern it cannot read instead of guessing what it covers", () => {
  expect(coveredBy(["libs/*/src/**", "!src/*.models.ts"], FILES)).toBe(
    "cannot read the cache inputs libs/*/src/**, !src/*.models.ts",
  );
});
