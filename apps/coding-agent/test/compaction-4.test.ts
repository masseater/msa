import { describe, expect, it } from "vite-plus/test";

import { type CompactionSettings, shouldCompact } from "../src/core/compaction/index.ts";
describe("shouldCompact", () => {
  it("should return true when context exceeds threshold", () => {
    const settings: CompactionSettings = {
      enabled: true,
      reserveTokens: 10000,
      keepRecentTokens: 20000,
    };

    expect(shouldCompact(95000, 100000, settings)).toBe(true);
    expect(shouldCompact(89000, 100000, settings)).toBe(false);
  });
  it("should return false when disabled", () => {
    const settings: CompactionSettings = {
      enabled: false,
      reserveTokens: 10000,
      keepRecentTokens: 20000,
    };

    expect(shouldCompact(95000, 100000, settings)).toBe(false);
  });
});
