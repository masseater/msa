import { beforeAll, describe, expect, it } from "vitest";

import type { SessionStats } from "../src/core/agent-session.ts";
import { formatSessionInfo, type SessionInfo } from "../src/modes/interactive/session-info.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

beforeAll(() => initTheme("dark"));

function info(overrides: Partial<SessionInfo> = {}): SessionInfo {
  const stats = {
    sessionFile: undefined,
    sessionId: "s1",
    totalMessages: 2,
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 0,
    toolResults: 0,
    tokens: { input: 100, output: 20, cacheRead: 300, cacheWrite: 0, total: 420 },
    cost: 0.5,
  } as SessionStats;
  return {
    stats,
    sessionName: undefined,
    cacheWaste: { missedTokens: 0, missedCost: 0, missCount: 0 } as SessionInfo["cacheWaste"],
    usageBreakdown: [{ key: "faux/one", cost: 0.5, tokens: 420 }] as SessionInfo["usageBreakdown"],
    cacheWarmingMode: "off" as SessionInfo["cacheWarmingMode"],
    cacheWarmingStatus: undefined,
    selectedModelKey: "faux/one",
    ...overrides,
  };
}

describe("formatSessionInfo", () => {
  it("splits prompt tokens into cached and uncached when the cache was used", () => {
    const text = stripAnsi(formatSessionInfo(info()));
    expect(text).toContain("Input: 400");
    expect(text).toContain("Cached: 300 (75.0%)");
    expect(text).toContain("Uncached: 100");
  });

  it("omits a cost breakdown that would only repeat the selected model's total", () => {
    expect(stripAnsi(formatSessionInfo(info()))).not.toContain("faux/one:");
  });

  it("breaks the cost down when another model was used", () => {
    const text = stripAnsi(formatSessionInfo(info({ selectedModelKey: "faux/two" })));
    expect(text).toContain("faux/one: $0.500 (420 tokens)");
  });
});
