import type { Usage } from "@msa/ai/compat";
import { describe, expect, it } from "vite-plus/test";

import { calculateContextTokens } from "../src/core/compaction/index.ts";

function createMockUsage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

describe("Token calculation", () => {
  it("should calculate total context tokens from usage", () => {
    const usage = createMockUsage(1000, 500, 200, 100);
    expect(calculateContextTokens(usage)).toBe(1800);
  });
  it("should handle zero values", () => {
    const usage = createMockUsage(0, 0, 0, 0);
    expect(calculateContextTokens(usage)).toBe(0);
  });
});
