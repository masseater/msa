import { beforeAll, describe, expect, it } from "vite-plus/test";

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
    contextBreakdown: { method: "estimated", tokens: 0, entries: [] },
    contextWindow: 200_000,
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

  it("lists the context elements under their parts with tokens and shares of the total", () => {
    const tools = Array.from({ length: 10 }, (_, index) => ({
      part: "tools" as const,
      name: `tool${index}`,
      tokens: 100 + index,
    }));
    const text = stripAnsi(
      formatSessionInfo(
        info({
          contextBreakdown: {
            method: "exact",
            tokens: 60_000,
            entries: [
              { part: "system", name: "preamble", tokens: 2_000 },
              { part: "system", name: "project_context", tokens: 6_000 },
              ...tools,
              { part: "conversation", name: "user", tokens: 1_000 },
              { part: "toolResults", name: "read", tokens: 49_955 },
            ],
          },
        }),
      ),
    );
    expect(text).toContain("Context exact");
    expect(text).toContain("Used: 60,000 / 200,000 (30.0%)");
    expect(text).toMatch(/System prompt\s+8,000\s+13\.3%/);
    expect(text).toMatch(/ {2}project_context\s+6,000\s+10\.0%/);
    expect(text).toMatch(/Tool results\s+49,955\s+83\.3%/);
    expect(text).toMatch(/ {2}tool9\s+109/);
    expect(text).not.toContain("tool2 ");
    expect(text).toMatch(/ {2}\+3\s+303/);
  });

  it("breaks the cost down when another model was used", () => {
    const text = stripAnsi(formatSessionInfo(info({ selectedModelKey: "faux/two" })));
    expect(text).toContain("faux/one: $0.500 (420 tokens)");
  });
});
