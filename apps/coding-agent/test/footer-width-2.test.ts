import { visibleWidth } from "@msa/tui";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type AssistantUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
};

function renderStatsLine(footer: FooterComponent): string {
  const statsLine = footer.render(120)[1];
  if (statsLine === undefined) throw new Error("expected the footer to render a stats line");
  return stripAnsi(statsLine);
}

type SessionOptions = {
  sessionName: string;
  modelId?: string;
  provider?: string;
  reasoning?: boolean;
  thinkingLevel?: string;
  usage?: AssistantUsage;
  branchUsage?: AssistantUsage;
  compactionUsage?: AssistantUsage;
  toolUsage?: AssistantUsage;
  usingSubscription?: boolean;
  routedModel?: { model: { id: string }; thinkingLevel?: string };
};

const usageEntries = (options: SessionOptions): Array<Record<string, unknown>> => {
  const entries: Array<Record<string, unknown>> = [];
  if (options.usage !== undefined)
    entries.push({ message: { role: "assistant", usage: options.usage }, type: "message" });
  if (options.branchUsage !== undefined)
    entries.push({ type: "branch_summary", usage: options.branchUsage });
  if (options.compactionUsage !== undefined)
    entries.push({ type: "compaction", usage: options.compactionUsage });
  if (options.toolUsage !== undefined)
    entries.push({ message: { role: "toolResult", usage: options.toolUsage }, type: "message" });
  return entries;
};

function createSession(options: SessionOptions): AgentSession {
  const entries = usageEntries(options);
  const session = {
    getContextUsage: () => ({ contextWindow: 200_000, percent: 12.3 }),
    modelRuntime: {
      isUsingSubscription: () => options.usingSubscription ?? false,
    },
    prWatch: { entries: [], last: undefined },
    routedModel: options.routedModel,
    sessionManager: {
      getCwd: () => "/tmp/project",
      getEntries: () => entries,
      getEntryCount: () => entries.length,
      getLeafId: () => null,
      getSessionId: () => "test-session",
      getSessionName: () => options.sessionName,
    },
    state: {
      model: {
        contextWindow: 200_000,
        id: options.modelId ?? "test-model",
        provider: options.provider ?? "test",
        reasoning: options.reasoning ?? false,
      },
      thinkingLevel: options.thinkingLevel ?? "off",
    },
  };
  return session as unknown as AgentSession;
}

function createFooterData(providerCount: number): ReadonlyFooterDataProvider {
  const provider = {
    getAvailableProviderCount: () => providerCount,
    getExtensionStatuses: () => new Map<string, string>(),
    getGitBranch: () => "main",
    onBranchChange: (callback: () => void) => {
      void callback;
      return () => {};
    },
  };

  return provider;
}

const keepsAllLinesWithinWidthForWide = () => {
  const width = 93;
  const session = createSession({ sessionName: "한글".repeat(30) });
  const footer = new FooterComponent(session, createFooterData(1));

  const lines = footer.render(width);
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
};

const keepsStatsLineWithinWidthForWide = () => {
  const width = 60;
  const session = createSession({
    modelId: "模".repeat(30),
    provider: "공급자",
    reasoning: true,
    sessionName: "",
    thinkingLevel: "high",
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { total: 1.234 },
      input: 12_345,
      output: 6_789,
    },
  });
  const footer = new FooterComponent(session, createFooterData(2));

  const lines = footer.render(width);
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
};

const showsThePhysicalModelAVirtualModel = () => {
  const session = createSession({
    modelId: "auto",
    reasoning: true,
    routedModel: { model: { id: "gpt-5.6-luna" }, thinkingLevel: "medium" },
    sessionName: "",
    thinkingLevel: "high",
  });
  const footer = new FooterComponent(session, createFooterData(1));

  const statsLine = renderStatsLine(footer);

  expect(statsLine).toContain("auto \u2022 high \u2192 gpt-5.6-luna \u2022 medium");
};

const includesSummaryAndToolResultUsageIn = () => {
  const session = createSession({
    branchUsage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { total: 0.25 },
      input: 20,
      output: 5,
    },
    compactionUsage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { total: 0.125 },
      input: 5,
      output: 2,
    },
    sessionName: "",
    toolUsage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { total: 0.375 },
      input: 15,
      output: 3,
    },
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { total: 0.5 },
      input: 100,
      output: 10,
    },
  });
  const footer = new FooterComponent(session, createFooterData(1));

  const statsLine = renderStatsLine(footer);
  expect(statsLine).toContain("$1.250");
};

const updatesCachedUsageTotalsAfterAnEntry = () => {
  const usage = { cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 }, input: 10, output: 1 };
  const session = createSession({ sessionName: "", usage });
  const footer = new FooterComponent(session, createFooterData(1));
  expect(renderStatsLine(footer)).toContain("$0.500");

  session.sessionManager
    .getEntries()
    .push({ message: { role: "assistant", usage }, type: "message" } as never);
  expect(renderStatsLine(footer)).toContain("$1.000");
};

const showsTheLatestCacheHitRateWhen = () => {
  const session = createSession({
    sessionName: "",
    usage: {
      cacheRead: 50,
      cacheWrite: 50,
      cost: { total: 0.001 },
      input: 100,
      output: 10,
    },
  });
  const footer = new FooterComponent(session, createFooterData(1));

  const statsLine = renderStatsLine(footer);
  expect(statsLine).toContain("CH25.0%");
};

const marksExplicitlyIdentifiedSubscriptionAuth = () => {
  const session = createSession({
    provider: "anthropic-api",
    sessionName: "",
    usingSubscription: true,
  });
  const footer = new FooterComponent(session, createFooterData(1));

  expect(renderStatsLine(footer)).toContain("$0.000 (sub)");
};

const doesNotMarkGenericOauthSignIn = () => {
  const session = createSession({
    provider: "openrouter",
    sessionName: "",
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { total: 1.234 },
      input: 100,
      output: 10,
    },
  });
  const footer = new FooterComponent(session, createFooterData(1));
  const stats = renderStatsLine(footer);

  expect(stats).toContain("$1.234");
  expect(stats).not.toContain("(sub)");
};

describe("FooterComponent width handling", () => {
  beforeAll(() => {
    initTheme(undefined, false);
  });

  it("keeps all lines within width for wide session names", keepsAllLinesWithinWidthForWide);

  it(
    "keeps stats line within width for wide model and provider names",
    keepsStatsLineWithinWidthForWide,
  );

  it("shows the physical model a virtual model routed to", showsThePhysicalModelAVirtualModel);

  it(
    "includes summary and tool result usage in the total cost",
    includesSummaryAndToolResultUsageIn,
  );

  it(
    "updates cached usage totals after an entry is appended",
    updatesCachedUsageTotalsAfterAnEntry,
  );

  it("shows the latest cache hit rate when cache usage is present", showsTheLatestCacheHitRateWhen);

  it("marks explicitly identified subscription auth", marksExplicitlyIdentifiedSubscriptionAuth);

  it("does not mark generic OAuth sign-in as a subscription", doesNotMarkGenericOauthSignIn);
});
