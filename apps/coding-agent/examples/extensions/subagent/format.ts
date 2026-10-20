import { homedir } from "os";

import type aiTypes from "@msa/ai/index.types";
import { formatReadLineRange } from "@msa/coding-agent";

import {
  type DisplayItem,
  PER_TASK_OUTPUT_CAP,
  type SingleResult,
  type UsageStats,
} from "./types.ts";

type ThemeFg = (
  color: "muted" | "accent" | "warning" | "dim" | "toolOutput",
  text: string,
) => string;

export const formatTokens = (count: number): string => {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
};

export const formatUsageStats = (request: {
  readonly usage: UsageStats;
  readonly model?: string | undefined;
}): string => {
  const { usage, model } = request;
  const parts: string[] = [];
  if (usage.turns !== undefined) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input !== 0) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output !== 0) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead !== 0) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite !== 0) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost !== 0) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens !== undefined && usage.contextTokens > 0) {
    parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  }
  if (model !== undefined && model.length > 0) parts.push(model);
  return parts.join(" ");
};

const shortenPath = (path: string): string => {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
};

const preview = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}...` : text;

const formatBashCall = (args: Record<string, unknown>, fg: ThemeFg): string =>
  fg("muted", "$ ") + fg("toolOutput", preview((args["command"] as string) || "...", 60));

const formatReadCall = (args: Record<string, unknown>, fg: ThemeFg): string => {
  const rawPath = (args["file_path"] ?? args["path"] ?? "...") as string;
  const lineRange = formatReadLineRange(args["offset"], args["limit"]);
  return (
    fg("muted", "read ") +
    fg("accent", shortenPath(rawPath)) +
    (lineRange.length > 0 ? fg("warning", lineRange) : "")
  );
};

const formatWriteCall = (args: Record<string, unknown>, fg: ThemeFg): string => {
  const rawPath = (args["file_path"] ?? args["path"] ?? "...") as string;
  const lines = ((args["content"] as string) || "").split("\n").length;
  const suffix = lines > 1 ? fg("dim", ` (${lines} lines)`) : "";
  return fg("muted", "write ") + fg("accent", shortenPath(rawPath)) + suffix;
};

const formatEditCall = (args: Record<string, unknown>, fg: ThemeFg): string => {
  const rawPath = (args["file_path"] ?? args["path"] ?? "...") as string;
  return fg("muted", "edit ") + fg("accent", shortenPath(rawPath));
};

const formatLsCall = (args: Record<string, unknown>, fg: ThemeFg): string =>
  fg("muted", "ls ") + fg("accent", shortenPath((args["path"] as string) || "."));

const formatFindCall = (args: Record<string, unknown>, fg: ThemeFg): string =>
  fg("muted", "find ") +
  fg("accent", (args["pattern"] as string) || "*") +
  fg("dim", ` in ${shortenPath((args["path"] as string) || ".")}`);

const formatGrepCall = (args: Record<string, unknown>, fg: ThemeFg): string =>
  fg("muted", "grep ") +
  fg("accent", `/${(args["pattern"] as string) || ""}/`) +
  fg("dim", ` in ${shortenPath((args["path"] as string) || ".")}`);

const formatOtherCall = (toolName: string, args: Record<string, unknown>, fg: ThemeFg): string =>
  fg("accent", toolName) + fg("dim", ` ${preview(JSON.stringify(args), 50)}`);

export const formatToolCall = (request: {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly themeFg: ThemeFg;
}): string => {
  const { toolName, args, themeFg } = request;
  switch (toolName) {
    case "bash":
      return formatBashCall(args, themeFg);
    case "read":
      return formatReadCall(args, themeFg);
    case "write":
      return formatWriteCall(args, themeFg);
    case "edit":
      return formatEditCall(args, themeFg);
    case "ls":
      return formatLsCall(args, themeFg);
    case "find":
      return formatFindCall(args, themeFg);
    case "grep":
      return formatGrepCall(args, themeFg);
    default:
      return formatOtherCall(toolName, args, themeFg);
  }
};

export const getFinalOutput = (messages: aiTypes.Message[]): string => {
  for (const msg of messages.toReversed()) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.content) {
      if (part.type === "text") return part.text;
    }
  }
  return "";
};

export const isFailedResult = (result: SingleResult): boolean =>
  result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";

export const getResultOutput = (result: SingleResult): string => {
  if (isFailedResult(result)) {
    return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
  }
  return getFinalOutput(result.messages) || "(no output)";
};

export const truncateParallelOutput = (output: string): string => {
  const byteLength = Buffer.byteLength(output, "utf8");
  if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

  let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
  while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
    truncated = truncated.slice(0, -1);
  }
  const omitted = byteLength - Buffer.byteLength(truncated, "utf8");
  return `${truncated}\n\n[Output truncated: ${omitted} bytes omitted. Full output preserved in tool details.]`;
};

export const getDisplayItems = (messages: aiTypes.Message[]): DisplayItem[] => {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.content) {
      if (part.type === "text") {
        items.push({ text: part.text, type: "text" });
      } else if (part.type === "toolCall") {
        items.push({ args: part.arguments, name: part.name, type: "toolCall" });
      }
    }
  }
  return items;
};

export const aggregateUsage = (results: SingleResult[]): UsageStats => {
  const total: UsageStats = {
    cacheRead: 0,
    cacheWrite: 0,
    contextTokens: 0,
    cost: 0,
    input: 0,
    output: 0,
    turns: 0,
  };
  for (const r of results) {
    total.input += r.usage.input;
    total.output += r.usage.output;
    total.cacheRead += r.usage.cacheRead;
    total.cacheWrite += r.usage.cacheWrite;
    total.cost += r.usage.cost;
    total.turns += r.usage.turns;
  }
  return total;
};
