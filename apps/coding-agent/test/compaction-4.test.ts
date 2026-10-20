import { describe, expect, it } from "vite-plus/test";

import { type CompactionSettings, shouldCompact } from "../src/core/compaction/index.ts";
const shouldReturnTrueWhenContextExceedsThreshold = () => {
  const settings: CompactionSettings = {
    enabled: true,
    keepRecentTokens: 20000,
    reserveTokens: 10000,
  };

  expect(shouldCompact(95000, 100000, settings)).toBe(true);
  expect(shouldCompact(89000, 100000, settings)).toBe(false);
};

const shouldReturnFalseWhenDisabled = () => {
  const settings: CompactionSettings = {
    enabled: false,
    keepRecentTokens: 20000,
    reserveTokens: 10000,
  };

  expect(shouldCompact(95000, 100000, settings)).toBe(false);
};

describe("shouldCompact", () => {
  it(
    "should return true when context exceeds threshold",
    shouldReturnTrueWhenContextExceedsThreshold,
  );
  it("should return false when disabled", shouldReturnFalseWhenDisabled);
});
