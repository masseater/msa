import type { SessionStats } from "../../core/agent-session.ts";
import type { CacheWasteTotals } from "../../core/cache-stats.ts";
import { type CacheWarmingStatus, formatCacheWarmingStatus } from "../../core/cache-warmer.ts";
import type { ContextBreakdown, ContextPart } from "../../core/context-breakdown.ts";
import type { CacheWarmingMode } from "../../core/settings-manager.ts";
import type { UsageCostBreakdownEntry } from "../../core/usage-totals.ts";
import { formatTokens } from "./components/footer.ts";
import { theme } from "./theme/theme.ts";

/** Everything `/status` reports, captured when the command runs. */
export type SessionInfo = {
  stats: SessionStats;
  sessionName: string | undefined;
  cacheWaste: CacheWasteTotals;
  usageBreakdown: readonly UsageCostBreakdownEntry[];
  cacheWarmingMode: CacheWarmingMode;
  cacheWarmingStatus: CacheWarmingStatus | undefined;
  /** `provider/id` of the selected model. */
  selectedModelKey: string;
  contextBreakdown: ContextBreakdown;
  contextWindow: number | undefined;
};

const label = (text: string): string => theme.fg("dim", text);

const CONTEXT_PARTS: readonly { part: ContextPart; title: string }[] = [
  { part: "system", title: "System prompt" },
  { part: "tools", title: "Tools" },
  { part: "conversation", title: "Conversation" },
  { part: "toolResults", title: "Tool results" },
  { part: "compaction", title: "Compaction" },
  { part: "other", title: "Other" },
];

/** Entries listed per part; the rest fold into one line. */
const CONTEXT_PART_LIMIT = 8;

/** The context section of `/status`: every element of the next request, largest first. */
export function formatContextBreakdown(
  breakdown: ContextBreakdown,
  contextWindow: number | undefined,
): string[] {
  const { tokens: total } = breakdown;
  const percent = (tokens: number): string =>
    total > 0 ? `${((tokens / total) * 100).toFixed(1)}%` : "-";
  const rows: { name: string; tokens: number; heading: boolean }[] = [];
  for (const { part, title } of CONTEXT_PARTS) {
    const entries = breakdown.entries
      .filter((entry) => entry.part === part)
      .sort((a, b) => b.tokens - a.tokens);
    if (entries.length === 0) continue;
    const partTokens = entries.reduce((sum, entry) => sum + entry.tokens, 0);
    rows.push({ name: title, tokens: partTokens, heading: true });
    const shown = entries.length > CONTEXT_PART_LIMIT ? CONTEXT_PART_LIMIT - 1 : entries.length;
    for (const entry of entries.slice(0, shown)) {
      rows.push({ name: `  ${entry.name}`, tokens: entry.tokens, heading: false });
    }
    const rest = entries.slice(shown);
    if (rest.length > 0) {
      rows.push({
        name: `  +${rest.length}`,
        tokens: rest.reduce((sum, entry) => sum + entry.tokens, 0),
        heading: false,
      });
    }
  }
  const nameWidth = Math.max(...rows.map((row) => row.name.length));
  const tokenWidth = Math.max(...rows.map((row) => row.tokens.toLocaleString().length));
  const used = contextWindow
    ? `${total.toLocaleString()} / ${contextWindow.toLocaleString()} ${label(`(${((total / contextWindow) * 100).toFixed(1)}%)`)}`
    : total.toLocaleString();
  const lines = [
    `${theme.bold("Context")} ${label(breakdown.method)}`,
    `${label("Used:")} ${used}`,
  ];
  for (const row of rows) {
    const cells = `${row.name.padEnd(nameWidth)}  ${row.tokens.toLocaleString().padStart(tokenWidth)}  ${percent(row.tokens).padStart(6)}`;
    lines.push(row.heading ? theme.bold(cells) : cells);
  }
  return lines;
}

/** The `/status` report. Built from the current theme, so call it again after theme changes. */
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

  lines.push(...formatContextBreakdown(info.contextBreakdown, info.contextWindow), "");

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
