import { beforeAll, describe, expect, it } from "vite-plus/test";

import type agentSessionTypes from "../src/core/agent-session.types.ts";
import sessionInfo from "../src/modes/interactive/session-info.ts";
import type sessionInfoTypes from "../src/modes/interactive/session-info.types.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";

const { initTheme } = themeModule;
const { formatSessionInfo } = sessionInfo;
const { stripAnsi } = ansi;

beforeAll(() => initTheme("dark"));

function info(overrides: Partial<sessionInfoTypes.SessionInfo> = {}): sessionInfoTypes.SessionInfo {
  const stats = {
    assistantMessages: 1,
    cost: 0.5,
    sessionFile: undefined,
    sessionId: "s1",
    tokens: { cacheRead: 300, cacheWrite: 0, input: 100, output: 20, total: 420 },
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 2,
    userMessages: 1,
  } as agentSessionTypes.SessionStats;
  return {
    cacheWarmingMode: "off" as sessionInfoTypes.SessionInfo["cacheWarmingMode"],
    cacheWarmingStatus: undefined,
    cacheWaste: {
      missCount: 0,
      missedCost: 0,
      missedTokens: 0,
    } as sessionInfoTypes.SessionInfo["cacheWaste"],
    contextBreakdown: { entries: [], method: "estimated", tokens: 0 },
    contextWindow: 200_000,
    selectedModelKey: "faux/one",
    sessionName: undefined,
    stats,
    telemetry: undefined,
    usageBreakdown: [
      { cost: 0.5, key: "faux/one", tokens: 420 },
    ] as sessionInfoTypes.SessionInfo["usageBreakdown"],
    ...overrides,
  };
}

const splitsPromptTokensIntoCachedAndUncached = () => {
  const text = stripAnsi(formatSessionInfo(info()));
  expect(text).toContain("Input: 400");
  expect(text).toContain("Cached: 300 (75.0%)");
  expect(text).toContain("Uncached: 100");
};

const omitsACostBreakdownThatWouldOnly = () => {
  expect(stripAnsi(formatSessionInfo(info()))).not.toContain("faux/one:");
};

const listsTheContextElementsUnderTheirParts = () => {
  const tools = Array.from({ length: 10 }, (_, index) => ({
    name: `tool${index}`,
    part: "tools" as const,
    tokens: 100 + index,
  }));
  const text = stripAnsi(
    formatSessionInfo(
      info({
        contextBreakdown: {
          entries: [
            { name: "preamble", part: "system", tokens: 2_000 },
            { name: "project_context", part: "system", tokens: 6_000 },
            ...tools,
            { name: "user", part: "conversation", tokens: 1_000 },
            { name: "read", part: "toolResults", tokens: 49_955 },
          ],
          method: "exact",
          tokens: 60_000,
        },
      }),
    ),
  );
  expect(text).toContain("Context exact");
  expect(text).toContain("Used: 60,000 / 200,000 (30.0%)");
  expect(text).toMatch(/System prompt\s+8,000\s+13\.3%/u);
  expect(text).toMatch(/ {2}project_context\s+6,000\s+10\.0%/u);
  expect(text).toMatch(/Tool results\s+49,955\s+83\.3%/u);
  expect(text).toMatch(/ {2}tool9\s+109/u);
  expect(text).not.toContain("tool2 ");
  expect(text).toMatch(/ {2}\+3\s+303/u);
};

const breaksTheCostDownWhenAnotherModel = () => {
  const text = stripAnsi(formatSessionInfo(info({ selectedModelKey: "faux/two" })));
  expect(text).toContain("faux/one: $0.500 (420 tokens)");
};

describe("formatSessionInfo", () => {
  it(
    "splits prompt tokens into cached and uncached when the cache was used",
    splitsPromptTokensIntoCachedAndUncached,
  );

  it(
    "omits a cost breakdown that would only repeat the selected model's total",
    omitsACostBreakdownThatWouldOnly,
  );

  it(
    "lists the context elements under their parts with tokens and shares of the total",
    listsTheContextElementsUnderTheirParts,
  );

  it("breaks the cost down when another model was used", breaksTheCostDownWhenAnotherModel);
});
