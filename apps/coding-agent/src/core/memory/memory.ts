import { execFileSync } from "node:child_process";
import { basename } from "node:path";

import { EmbeddingClient } from "./embeddings.ts";
import {
  MEMORY_KINDS,
  MemoryStore,
  type MemoryKind,
  type MemoryRecord,
  type MemorySaveResult,
  type MemoryScope,
  type MemoryScore,
  type MemoryStoreStats,
} from "./store.ts";

export const MEMORY_RECALL_MESSAGE_TYPE = "msa.memory.recall";

const EMBEDDING_FAILURE_COOLDOWN_MS = 60_000;

const REEMBED_BATCH_LIMIT = 25;

const EXPLICIT_SEARCH_MIN_SCORE = 0.1;

export interface ResolvedMemorySettings {
  enabled: boolean;
  database: string;
  embedding: {
    enabled: boolean;
    baseUrl: string;
    model: string;
    queryPrefix: string;
    documentPrefix: string;
    apiKey?: string;
    timeoutMs: number;
  };
  recall: {
    enabled: boolean;
    limit: number;
    minScore: number;
  };
}

export interface MemoryServiceOptions {
  settings: ResolvedMemorySettings;
  cwd: string;
  project?: string;
}

export interface MemorySaveRequest {
  content: string;
  kind?: MemoryKind;
  scope?: MemoryScope;
}

export interface MemorySaveOutcome extends MemorySaveResult {
  embedded: boolean;
  embeddingError?: string;
}

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

export function formatAge(timestamp: number, now = Date.now()): string {
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

export function formatMemoryList(records: readonly MemoryRecord[], now = Date.now()): string {
  if (records.length === 0) return "No memories stored yet.";
  return [
    `${records.length} ${records.length === 1 ? "memory" : "memories"}:`,
    ...records.map(
      (record) =>
        `- ${record.id} [${record.kind} · ${scopeLabel(record)}] ${truncate(record.content)} (${formatAge(record.updatedAt, now)})`,
    ),
  ].join("\n");
}

function formatSignals(scored: MemoryScore): string {
  const signals = [`keywords ${Math.round(scored.keyword * 100)}%`];
  if (scored.vector !== undefined) signals.unshift(`similarity ${scored.vector.toFixed(2)}`);
  return signals.join(", ");
}

export function formatSearchResults(scores: readonly MemoryScore[], now = Date.now()): string {
  if (scores.length === 0) return "No matching memories.";
  return [
    `${scores.length} ${scores.length === 1 ? "match" : "matches"}:`,
    ...scores.map(
      (scored) =>
        `- ${scored.record.id} [${scored.record.kind} · ${scopeLabel(scored.record)}] ${formatSignals(scored)}: ${truncate(scored.record.content, 200)} (${formatAge(scored.record.updatedAt, now)})`,
    ),
  ].join("\n");
}

export class MemoryService {
  readonly settings: ResolvedMemorySettings;
  readonly project: string;
  private store: MemoryStore | undefined;
  private embedding: EmbeddingClient | undefined;
  private embeddingFailedAt: number | undefined;
  private lastEmbeddingError: string | undefined;

  constructor(options: MemoryServiceOptions) {
    this.settings = options.settings;
    this.project = options.project ?? resolveProjectName(options.cwd);
    if (this.settings.embedding.enabled) {
      const apiKey = this.settings.embedding.apiKey;
      this.embedding = new EmbeddingClient({
        baseUrl: this.settings.embedding.baseUrl,
        model: this.settings.embedding.model,
        ...(apiKey !== undefined && apiKey !== "" ? { apiKey } : {}),
        timeoutMs: this.settings.embedding.timeoutMs,
      });
    }
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  get recallEnabled(): boolean {
    return this.settings.enabled && this.settings.recall.enabled;
  }

  warm(): void {
    if (!this.recallEnabled) return;
    void this.embedQuery("warmup")
      .then(() => this.reembedStale())
      .catch(() => undefined);
  }

  async reembedStale(limit = REEMBED_BATCH_LIMIT): Promise<number> {
    if (!this.settings.enabled || this.embedding === undefined) return 0;
    let reembedded = 0;
    for (const record of this.ensureStore().listStale(this.settings.embedding.model, limit)) {
      const vector = await this.embedDocument(record.content);
      if (vector === undefined) break;
      this.ensureStore().setEmbedding(record.id, vector, this.settings.embedding.model);
      reembedded++;
    }
    return reembedded;
  }

  private ensureStore(): MemoryStore {
    this.store ??= new MemoryStore(this.settings.database);
    return this.store;
  }

  private async embed(text: string, signal?: AbortSignal): Promise<Float32Array | undefined> {
    const client = this.embedding;
    if (client === undefined) return undefined;
    const failedAt = this.embeddingFailedAt;
    if (failedAt !== undefined && Date.now() - failedAt < EMBEDDING_FAILURE_COOLDOWN_MS) {
      return undefined;
    }
    try {
      const vector = await client.embed(text, signal);
      this.embeddingFailedAt = undefined;
      this.lastEmbeddingError = undefined;
      return vector;
    } catch (error) {
      this.embeddingFailedAt = Date.now();
      this.lastEmbeddingError = error instanceof Error ? error.message : String(error);
      return undefined;
    }
  }

  private embedDocument(text: string, signal?: AbortSignal): Promise<Float32Array | undefined> {
    return this.embed(`${this.settings.embedding.documentPrefix}${text}`, signal);
  }

  private embedQuery(text: string, signal?: AbortSignal): Promise<Float32Array | undefined> {
    return this.embed(`${this.settings.embedding.queryPrefix}${text}`, signal);
  }

  async recall(query: string, signal?: AbortSignal): Promise<MemoryRecord[]> {
    if (!this.recallEnabled || !query.trim()) return [];
    try {
      const embedding = await this.embedQuery(query, signal);
      const scores = this.ensureStore().search({
        text: query,
        ...(embedding === undefined ? {} : { embedding }),
        project: this.project,
        limit: this.settings.recall.limit,
        minScore: this.settings.recall.minScore,
      });
      const records = scores.map((scored) => scored.record);
      if (records.length > 0) this.ensureStore().markUsed(records.map((record) => record.id));
      return records;
    } catch {
      return [];
    }
  }

  async save(request: MemorySaveRequest): Promise<MemorySaveOutcome> {
    const content = request.content.trim();
    if (content === "") throw new Error("Memory content is empty");
    const kind = request.kind ?? "fact";
    if (!isMemoryKind(kind)) {
      throw new Error(`Unknown memory kind "${kind}"; use one of ${MEMORY_KINDS.join(", ")}`);
    }
    const scope = request.scope ?? "project";
    if (scope !== "project" && scope !== "global") {
      throw new Error(`Unknown memory scope "${scope}"; use project or global`);
    }
    const embedding = await this.embedDocument(content);
    const result = this.ensureStore().save({
      content,
      kind,
      scope,
      project: this.project,
      ...(embedding === undefined
        ? {}
        : { embedding, embeddingModel: this.settings.embedding.model }),
    });
    return {
      ...result,
      embedded: embedding !== undefined,
      ...(embedding === undefined &&
      this.lastEmbeddingError !== undefined &&
      this.lastEmbeddingError !== ""
        ? { embeddingError: this.lastEmbeddingError }
        : {}),
    };
  }

  async search(query: string, limit = 5): Promise<MemoryScore[]> {
    const embedding = await this.embedQuery(query);
    return this.ensureStore().search({
      text: query,
      ...(embedding === undefined ? {} : { embedding }),
      project: this.project,
      limit,
      minScore: EXPLICIT_SEARCH_MIN_SCORE,
    });
  }

  list(limit = 20): MemoryRecord[] {
    return this.ensureStore().list({ project: this.project, limit });
  }

  stats(): MemoryStoreStats {
    return this.ensureStore().stats();
  }

  forget(id: string): boolean {
    return this.ensureStore().forget(id);
  }

  describeStatus(): string {
    if (!this.settings.enabled) return "Memory is disabled (settings: memory.enabled).";
    const stats = this.ensureStore().stats();
    const embedding = this.settings.embedding.enabled
      ? this.lastEmbeddingError !== undefined && this.lastEmbeddingError !== ""
        ? `unavailable: ${truncate(this.lastEmbeddingError, 120)}`
        : `${this.settings.embedding.model} at ${this.settings.embedding.baseUrl}`
      : "disabled";
    return [
      "Memory is enabled.",
      `Project: ${this.project}`,
      `Database: ${this.settings.database}`,
      `Stored: ${stats.total} (${stats.embedded} embedded, ${stats.projects} projects)`,
      `Embedding: ${embedding}`,
      "Commands: /memory list, /memory search <query>, /memory forget <id>, /memory stats",
    ].join("\n");
  }

  describeStats(): string {
    if (!this.settings.enabled) return "Memory is disabled (settings: memory.enabled).";
    const stats = this.ensureStore().stats();
    const kinds = Object.entries(stats.byKind)
      .map(([kind, count]) => `${kind}: ${count}`)
      .join(", ");
    return [
      `Total: ${stats.total} (${stats.embedded} embedded)`,
      kinds === "" ? "Kinds: none" : `Kinds: ${kinds}`,
      `Projects: ${stats.projects}`,
      `Database: ${this.settings.database}`,
    ].join("\n");
  }

  close(): void {
    this.store?.close();
    this.store = undefined;
  }
}

export function resolveProjectName(dir: string): string {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (top !== "") return basename(top);
  } catch {}
  return basename(dir) || dir;
}
