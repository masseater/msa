import { currentTimeMillis } from "../platform/index.ts";
import type { ResolvedMemorySettings } from "./memory-types.ts";
import {
  MEMORY_KINDS,
  type MemoryKind,
  type MemoryRecord,
  type MemoryScore,
  type MemoryStoreStats,
} from "./store.ts";

export type MemoryCommand =
  | { kind: "status" }
  | { kind: "list" }
  | { kind: "stats" }
  | { kind: "search"; query: string }
  | { kind: "forget"; id: string };

export function parseMemoryCommand(text: string): MemoryCommand | undefined {
  const match = /^\/memory(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (match === null) return undefined;
  const args = (match[1] ?? "").trim();
  if (args === "") return { kind: "status" };
  const [head = "", ...rest] = args.split(/\s+/u);
  const tail = rest.join(" ").trim();
  switch (head) {
    case "list":
      return { kind: "list" };
    case "stats":
      return { kind: "stats" };
    case "search":
      return tail === "" ? { kind: "status" } : { kind: "search", query: tail };
    case "forget":
      return tail === "" ? { kind: "status" } : { kind: "forget", id: tail };
    default:
      return { kind: "search", query: args };
  }
}

export function isMemoryKind(value: string): value is MemoryKind {
  return (MEMORY_KINDS as readonly string[]).includes(value);
}

function truncate(text: string, max = 160): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function formatAge(timestamp: number): string {
  const now = currentTimeMillis();
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function scopeLabel(record: MemoryRecord): string {
  return record.scope === "project" ? `project:${record.project ?? "?"}` : "global";
}

export function formatRecallBlock(records: readonly MemoryRecord[]): string {
  return [
    "<memory>",
    "Long-term memory from previous sessions, recalled for this request. The memory tool can save, search, and forget memories.",
    ...records.map((record) => `- [${record.kind} · ${scopeLabel(record)}] ${record.content}`),
    "</memory>",
  ].join("\n");
}

export function formatMemoryList(records: readonly MemoryRecord[]): string {
  if (records.length === 0) return "No memories stored yet.";
  return [
    `${records.length} ${records.length === 1 ? "memory" : "memories"}:`,
    ...records.map(
      (record) =>
        `- ${record.id} [${record.kind} · ${scopeLabel(record)}] ${truncate(record.content)} (${formatAge(record.updatedAt)})`,
    ),
  ].join("\n");
}

function formatSignals(scored: MemoryScore): string {
  const signals = [`keywords ${Math.round(scored.keyword * 100)}%`];
  if (scored.vector !== undefined) signals.unshift(`similarity ${scored.vector.toFixed(2)}`);
  return signals.join(", ");
}

export function formatSearchResults(scores: readonly MemoryScore[]): string {
  if (scores.length === 0) return "No matching memories.";
  return [
    `${scores.length} ${scores.length === 1 ? "match" : "matches"}:`,
    ...scores.map(
      (scored) =>
        `- ${scored.record.id} [${scored.record.kind} · ${scopeLabel(scored.record)}] ${formatSignals(scored)}: ${truncate(scored.record.content, 200)} (${formatAge(scored.record.updatedAt)})`,
    ),
  ].join("\n");
}

export interface MemoryStatusInput {
  settings: ResolvedMemorySettings;
  project: string;
  stats: MemoryStoreStats;
  lastEmbeddingError: string | undefined;
}

export function formatMemoryStatus({
  settings,
  project,
  stats,
  lastEmbeddingError,
}: MemoryStatusInput): string {
  const failed = lastEmbeddingError !== undefined && lastEmbeddingError !== "";
  const embedding = settings.embedding.enabled
    ? failed
      ? `unavailable: ${truncate(lastEmbeddingError, 120)}`
      : `${settings.embedding.model} at ${settings.embedding.baseUrl}`
    : "disabled";
  return [
    "Memory is enabled.",
    `Project: ${project}`,
    `Database: ${settings.database}`,
    `Stored: ${stats.total} (${stats.embedded} embedded, ${stats.projects} projects)`,
    `Embedding: ${embedding}`,
    "Commands: /memory list, /memory search <query>, /memory forget <id>, /memory stats",
  ].join("\n");
}

export function formatMemoryStats({
  settings,
  stats,
}: {
  settings: ResolvedMemorySettings;
  stats: MemoryStoreStats;
}): string {
  const kinds = Object.entries(stats.byKind)
    .map(([kind, count]) => `${kind}: ${count}`)
    .join(", ");
  return [
    `Total: ${stats.total} (${stats.embedded} embedded)`,
    kinds === "" ? "Kinds: none" : `Kinds: ${kinds}`,
    `Projects: ${stats.projects}`,
    `Database: ${settings.database}`,
  ].join("\n");
}
