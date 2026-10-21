import textModule from "../../utils/text.ts";
import type memoryFormatTypes from "./memory-format.types.ts";
import type memoryTypesTypes from "./memory-types.ts";
import storeTypesModule from "./store-types.ts";
import type storeTypes from "./store.types.ts";

const { MEMORY_KINDS } = storeTypesModule;
const { formatAge } = textModule;

function parseMemoryCommand(text: string): memoryFormatTypes.MemoryCommand | undefined {
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
      return tail === "" ? { kind: "status" } : { id: tail, kind: "forget" };
    default:
      return { kind: "search", query: args };
  }
}

function isMemoryKind(value: string): value is storeTypes.MemoryKind {
  return (MEMORY_KINDS as readonly string[]).includes(value);
}

function truncate(text: string, max = 160): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function scopeLabel(record: storeTypes.MemoryRecord): string {
  return record.scope === "project" ? `project:${record.project ?? "?"}` : "global";
}

function formatRecallBlock(records: readonly storeTypes.MemoryRecord[]): string {
  return [
    "<memory>",
    "Long-term memory from previous sessions, recalled for this request. The memory tool can save, search, and forget memories.",
    ...records.map((record) => `- [${record.kind} · ${scopeLabel(record)}] ${record.content}`),
    "</memory>",
  ].join("\n");
}

function formatMemoryList(records: readonly storeTypes.MemoryRecord[]): string {
  if (records.length === 0) return "No memories stored yet.";
  return [
    `${records.length} ${records.length === 1 ? "memory" : "memories"}:`,
    ...records.map(
      (record) =>
        `- ${record.id} [${record.kind} · ${scopeLabel(record)}] ${truncate(record.content)} (${formatAge(record.updatedAt)})`,
    ),
  ].join("\n");
}

function formatSignals(scored: storeTypes.MemoryScore): string {
  const signals = [`keywords ${Math.round(scored.keyword * 100)}%`];
  if (scored.vector !== undefined) signals.unshift(`similarity ${scored.vector.toFixed(2)}`);
  return signals.join(", ");
}

function formatSearchResults(scores: readonly storeTypes.MemoryScore[]): string {
  if (scores.length === 0) return "No matching memories.";
  return [
    `${scores.length} ${scores.length === 1 ? "match" : "matches"}:`,
    ...scores.map(
      (scored) =>
        `- ${scored.record.id} [${scored.record.kind} · ${scopeLabel(scored.record)}] ${formatSignals(scored)}: ${truncate(scored.record.content, 200)} (${formatAge(scored.record.updatedAt)})`,
    ),
  ].join("\n");
}

function formatMemoryStatus({
  settings,
  project,
  stats,
  lastEmbeddingError,
}: memoryFormatTypes.MemoryStatusInput): string {
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

function formatMemoryStats({
  settings,
  stats,
}: {
  settings: memoryTypesTypes.ResolvedMemorySettings;
  stats: storeTypes.MemoryStoreStats;
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

const memoryFormat = {
  formatMemoryList,
  formatMemoryStats,
  formatMemoryStatus,
  formatRecallBlock,
  formatSearchResults,
  isMemoryKind,
  parseMemoryCommand,
};

export default memoryFormat;
