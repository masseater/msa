import { describe, expect, it } from "vite-plus/test";

import { cosineSimilarity, reciprocalRankFusion, segmentWords } from "../src/core/memory/store.ts";
import memorySupport from "./memory-support.ts";

const { vector } = memorySupport;

const splitsEnglishAndJapaneseIntoLowercasedWords = () => {
  expect(segmentWords("Prefer pnpm over npm.")).toEqual(["prefer", "pnpm", "over", "npm"]);
  expect(segmentWords("記憶の保存先は？")).toEqual(expect.arrayContaining(["記憶", "保存"]));
};

describe("segmentWords", () => {
  it(
    "splits English and Japanese into lowercased words without punctuation",
    splitsEnglishAndJapaneseIntoLowercasedWords,
  );
});

const adds160RankFromEveryRanking = () => {
  const fused = reciprocalRankFusion([
    ["a", "b"],
    ["b", "c"],
  ]);
  expect(fused.get("a")).toBeCloseTo(1 / 61);
  expect(fused.get("b")).toBeCloseTo(1 / 62 + 1 / 61);
  expect(fused.get("c")).toBeCloseTo(1 / 62);
};

describe("reciprocalRankFusion", () => {
  it("adds 1 / (60 + rank) from every ranking", adds160RankFromEveryRanking);
});

const scoresIdenticalOrthogonalAndMismatchedVectors = () => {
  expect(cosineSimilarity(vector([1, 0]), vector([1, 0]))).toBeCloseTo(1);
  expect(cosineSimilarity(vector([1, 0]), vector([0, 1]))).toBeCloseTo(0);
  expect(cosineSimilarity(vector([1, 0]), vector([1, 0, 0]))).toBe(0);
};

describe("cosineSimilarity", () => {
  it(
    "scores identical, orthogonal, and mismatched vectors",
    scoresIdenticalOrthogonalAndMismatchedVectors,
  );
});
