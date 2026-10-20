import type compatTypes from "@msa/ai/compat.types";

import type sessionManagerTypes from "./session-manager.types.ts";
import type usageTotalsTypes from "./usage-totals.types.ts";

function createUsageTotals(): usageTotalsTypes.UsageTotals {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    input: 0,
    output: 0,
  };
}

function addUsageToTotals(totals: usageTotalsTypes.UsageTotals, usage: compatTypes.Usage): void {
  totals.input += usage.input;
  totals.output += usage.output;
  totals.cacheRead += usage.cacheRead;
  totals.cacheWrite += usage.cacheWrite;
  totals.cost += usage.cost.total;
}

function combineUsage(first: compatTypes.Usage, second: compatTypes.Usage): compatTypes.Usage {
  return {
    cacheRead: first.cacheRead + second.cacheRead,
    cacheWrite: first.cacheWrite + second.cacheWrite,
    input: first.input + second.input,
    output: first.output + second.output,
    ...(first.cacheWrite1h !== undefined || second.cacheWrite1h !== undefined
      ? { cacheWrite1h: (first.cacheWrite1h ?? 0) + (second.cacheWrite1h ?? 0) }
      : {}),
    ...(first.reasoning !== undefined || second.reasoning !== undefined
      ? { reasoning: (first.reasoning ?? 0) + (second.reasoning ?? 0) }
      : {}),
    cost: {
      cacheRead: first.cost.cacheRead + second.cost.cacheRead,
      cacheWrite: first.cost.cacheWrite + second.cost.cacheWrite,
      input: first.cost.input + second.cost.input,
      output: first.cost.output + second.cost.output,
      total: first.cost.total + second.cost.total,
    },
    totalTokens: first.totalTokens + second.totalTokens,
  };
}

function getUsageCostBreakdown(
  entries: sessionManagerTypes.SessionEntry[],
): usageTotalsTypes.UsageCostBreakdownEntry[] {
  const totalsByKey = new Map<string, usageTotalsTypes.UsageTotals>();

  for (const entry of entries) {
    let key: string | undefined;
    let usage: compatTypes.Usage | undefined;
    if (entry.type === "message" && entry.message.role === "assistant") {
      key = `${entry.message.provider}/${entry.message.responseModel ?? entry.message.model}`;
      usage = entry.message.usage;
    } else if (entry.type === "usage") {
      key = `${entry.provider}/${entry.model}`;
      usage = entry.usage;
    } else if (
      entry.type === "message" &&
      entry.message.role === "toolResult" &&
      entry.message.usage !== undefined
    ) {
      key = "Tools/summaries";
      usage = entry.message.usage;
    } else if (
      (entry.type === "branch_summary" || entry.type === "compaction") &&
      entry.usage !== undefined
    ) {
      key = "Tools/summaries";
      usage = entry.usage;
    }
    if (key === undefined || key === "" || usage === undefined) continue;

    let totals = totalsByKey.get(key);
    if (totals === undefined) {
      totals = createUsageTotals();
      totalsByKey.set(key, totals);
    }
    addUsageToTotals(totals, usage);
  }

  return Array.from(totalsByKey, ([key, totals]) => ({
    cost: totals.cost,
    key,
    tokens: totals.input + totals.output + totals.cacheRead + totals.cacheWrite,
  }))
    .filter((entry) => entry.cost > 0 || entry.tokens > 0)
    .sort((a, b) => b.cost - a.cost);
}

const usageTotals = {
  addUsageToTotals,
  combineUsage,
  createUsageTotals,
  getUsageCostBreakdown,
};

export default usageTotals;
