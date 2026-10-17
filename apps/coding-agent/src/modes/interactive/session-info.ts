import type { SessionStats } from "../../core/agent-session.ts";
import type { CacheWasteTotals } from "../../core/cache-stats.ts";
import { type CacheWarmingStatus, formatCacheWarmingStatus } from "../../core/cache-warmer.ts";
import type { CacheWarmingMode } from "../../core/settings-manager.ts";
import type { UsageCostBreakdownEntry } from "../../core/usage-totals.ts";
import { formatTokens } from "./components/footer.ts";
import { theme } from "./theme/theme.ts";

/** Everything `/session` reports, captured when the command runs. */
export type SessionInfo = {
  stats: SessionStats;
  sessionName: string | undefined;
  cacheWaste: CacheWasteTotals;
  usageBreakdown: readonly UsageCostBreakdownEntry[];
  cacheWarmingMode: CacheWarmingMode;
  cacheWarmingStatus: CacheWarmingStatus | undefined;
  /** `provider/id` of the selected model. */
  selectedModelKey: string;
};

const label = (text: string): string => theme.fg("dim", text);

/** The `/session` report. Built from the current theme, so call it again after theme changes. */
export function formatSessionInfo(info: SessionInfo): string {
  const { stats, cacheWaste, usageBreakdown, cacheWarmingStatus } = info;
  const lines: string[] = [theme.bold("Session Info"), ""];
  if (info.sessionName) lines.push(`${label("Name:")} ${info.sessionName}`);
  lines.push(`${label("File:")} ${stats.sessionFile ?? "In-memory"}`);
  lines.push(`${label("ID:")} ${stats.sessionId}`, "");

  lines.push(theme.bold("Messages"));
  lines.push(`${label("Total:")} ${stats.totalMessages}`);
  lines.push(`${label("User:")} ${stats.userMessages}`);
  lines.push(`${label("Assistant:")} ${stats.assistantMessages}`);
  lines.push(`${label("Tools:")} ${stats.toolCalls} calls, ${stats.toolResults} results`, "");

  // "Input" is the full prompt volume. With cache activity it splits into cached and uncached
  // tokens, the only split every provider reports; cache writes are part of the uncached tokens.
  lines.push(theme.bold("Tokens"));
  const { input, cacheRead, cacheWrite } = stats.tokens;
  const promptTokens = input + cacheRead + cacheWrite;
  lines.push(`${label("Input:")} ${promptTokens.toLocaleString()}`);
  if (promptTokens > 0 && (cacheRead > 0 || cacheWrite > 0)) {
    const hitRate = label(`(${((cacheRead / promptTokens) * 100).toFixed(1)}%)`);
    lines.push(`  ${label("Cached:")} ${cacheRead.toLocaleString()} ${hitRate}`);
    const written =
      cacheWrite > 0 ? ` ${label(`(${cacheWrite.toLocaleString()} written to cache)`)}` : "";
    lines.push(`  ${label("Uncached:")} ${(input + cacheWrite).toLocaleString()}${written}`);
  }
  lines.push(`${label("Output:")} ${stats.tokens.output.toLocaleString()}`);
  lines.push(`${label("Total:")} ${stats.tokens.total.toLocaleString()}`, "");

  lines.push(theme.bold("Cache Warming"));
  lines.push(`${label("Mode:")} ${info.cacheWarmingMode}`);
  lines.push(
    `${label("Status:")} ${cacheWarmingStatus ? formatCacheWarmingStatus(cacheWarmingStatus) : "Inactive (cache warming unavailable)"}`,
  );
  const decision = cacheWarmingStatus?.decision;
  if (decision?.economicsAvailable) {
    lines.push(`${label("Cache miss penalty:")} $${decision.missCost.toFixed(3)}`);
    lines.push(`${label("Refresh cost:")} $${decision.warmCost.toFixed(3)}`);
  }

  if (stats.cost > 0 || cacheWaste.missedTokens > 0) {
    lines.push("", theme.bold("Cost"), `${label("Total:")} $${stats.cost.toFixed(3)}`);
    // A single entry repeats the total, unless it names a model other than the selected one.
    if (usageBreakdown.length > 1 || usageBreakdown[0]?.key !== info.selectedModelKey) {
      for (const entry of usageBreakdown) {
        lines.push(
          `  ${label(`${entry.key}:`)} $${entry.cost.toFixed(3)} ${label(`(${formatTokens(entry.tokens)} tokens)`)}`,
        );
      }
    }
    if (cacheWaste.missedTokens > 0) {
      const misses = cacheWaste.missCount === 1 ? "1 miss" : `${cacheWaste.missCount} misses`;
      const detail = `${cacheWaste.missedTokens.toLocaleString()} tokens, ${misses}`;
      lines.push(
        cacheWaste.missedCost >= 0.0001
          ? `${label("Cache Re-billed:")} $${cacheWaste.missedCost.toFixed(3)} ${label(`(${detail})`)}`
          : `${label("Cache Re-billed:")} ${detail}`,
      );
    }
    return lines.join("\n");
  }
  return `${lines.join("\n")}\n`;
}
