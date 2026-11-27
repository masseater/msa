import { describe, expect, it } from "vite-plus/test";

import compaction from "../src/core/compaction/index.ts";
import compactionSupport from "./compaction-support.ts";

const { createMockUsage } = compactionSupport;

const { calculateContextTokens } = compaction;

const shouldCalculateTotalContextTokensFromUsage = () => {
  const usage = createMockUsage(1000, 500, 200, 100);
  expect(calculateContextTokens(usage)).toBe(1800);
};

const shouldHandleZeroValues = () => {
  const usage = createMockUsage(0, 0, 0, 0);
  expect(calculateContextTokens(usage)).toBe(0);
};

describe("Token calculation", () => {
  it(
    "should calculate total context tokens from usage",
    shouldCalculateTotalContextTokensFromUsage,
  );
  it("should handle zero values", shouldHandleZeroValues);
});
