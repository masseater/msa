import { Effect, FileSystem } from "effect";

import {
  ToolFailure,
  currentTimeMillis,
  fromPromise,
  pathOperations,
  platformRuntime,
  unwrapForeign,
} from "../platform/index.ts";
import { EmbeddingClient } from "./embeddings.ts";
import { formatMemoryStats, formatMemoryStatus, isMemoryKind } from "./memory-format.ts";
import { projectNameOf } from "./memory-project.ts";
import type {
  MemorySaveOutcome,
  MemorySaveRequest,
  MemoryServiceOptions,
  ResolvedMemorySettings,
} from "./memory-types.ts";
import {
  MEMORY_KINDS,
  type MemoryRecord,
  type MemoryScore,
  MemoryStore,
  type MemoryStoreStats,
} from "./store.ts";

export const MEMORY_RECALL_MESSAGE_TYPE = "msa.memory.recall";

export { resolveProjectName } from "./memory-project.ts";
export {
  formatMemoryList,
  formatRecallBlock,
  formatSearchResults,
  isMemoryKind,
  type MemoryCommand,
  parseMemoryCommand,
} from "./memory-format.ts";
export type {
  MemorySaveOutcome,
  MemoryServiceOptions,
  MemorySaveRequest,
  ResolvedMemorySettings,
} from "./memory-types.ts";

const EMBEDDING_FAILURE_COOLDOWN_MS = 60_000;

const REEMBED_BATCH_LIMIT = 25;

const EXPLICIT_SEARCH_MIN_SCORE = 0.1;

export class MemoryService {
  readonly settings: ResolvedMemorySettings;
  private projectName: string;
  private store: MemoryStore | undefined;
  private embedding: EmbeddingClient | undefined;
  private embeddingFailedAt: number | undefined;
  private lastEmbeddingError: string | undefined;
  private readonly ready: Promise<void>;

  constructor(options: MemoryServiceOptions) {
    this.settings = options.settings;
    this.projectName = options.project ?? (pathOperations.basename(options.cwd) || options.cwd);
    if (this.settings.embedding.enabled) {
      const apiKey = this.settings.embedding.apiKey;
      this.embedding = new EmbeddingClient({
        baseUrl: this.settings.embedding.baseUrl,
        model: this.settings.embedding.model,
        ...(apiKey !== undefined && apiKey !== "" ? { apiKey } : {}),
        timeoutMs: this.settings.embedding.timeoutMs,
      });
    }
    this.ready = platformRuntime.runPromise(this.prepare(options));
  }

  get project(): string {
    return this.projectName;
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  get recallEnabled(): boolean {
    return this.settings.enabled && this.settings.recall.enabled;
  }

  warm(): void {
    if (!this.recallEnabled || this.storeIsEmpty()) return;
    platformRuntime.runFork(
      this.embedQuery("warmup").pipe(
        Effect.andThen(this.reembedStaleEffect(REEMBED_BATCH_LIMIT)),
        Effect.ignore,
      ),
    );
  }

  reembedStale(limit = REEMBED_BATCH_LIMIT): Promise<number> {
    return platformRuntime.runPromise(unwrapForeign(this.reembedStaleEffect(limit)));
  }

  recall(query: string, signal?: AbortSignal): Promise<MemoryRecord[]> {
    return platformRuntime.runPromise(this.recallEffect(query, signal));
  }

  save(request: MemorySaveRequest): Promise<MemorySaveOutcome> {
    return platformRuntime.runPromise(unwrapForeign(this.saveEffect(request)));
  }

  search(query: string, limit = 5): Promise<MemoryScore[]> {
    return platformRuntime.runPromise(unwrapForeign(this.searchEffect(query, limit)));
  }

  list(limit = 20): MemoryRecord[] {
    return this.ensureStore().list({ limit, project: this.project });
  }

  stats(): MemoryStoreStats {
    return this.ensureStore().stats();
  }

  forget(id: string): boolean {
    return this.ensureStore().forget(id);
  }

  describeStatus(): string {
    if (!this.settings.enabled) return "Memory is disabled (settings: memory.enabled).";
    return formatMemoryStatus({
      lastEmbeddingError: this.lastEmbeddingError,
      project: this.project,
      settings: this.settings,
      stats: this.ensureStore().stats(),
    });
  }

  describeStats(): string {
    if (!this.settings.enabled) return "Memory is disabled (settings: memory.enabled).";
    return formatMemoryStats({ settings: this.settings, stats: this.ensureStore().stats() });
  }

  close(): void {
    this.store?.close();
    this.store = undefined;
  }

  private prepare(options: MemoryServiceOptions) {
    return Effect.gen({ self: this }, function* () {
      if (options.project === undefined) {
        const name = yield* projectNameOf(options.cwd);
        if (name !== undefined) this.projectName = name;
      }
      if (this.settings.database !== ":memory:") {
        const directory = pathOperations.dirname(this.settings.database);
        yield* FileSystem.FileSystem.use((fs) => fs.makeDirectory(directory, { recursive: true }));
      }
    }).pipe(Effect.ignore);
  }

  private storeIsEmpty(): boolean {
    try {
      return this.ensureStore().isEmpty();
    } catch {
      return true;
    }
  }

  private ensureStore(): MemoryStore {
    this.store ??= new MemoryStore(this.settings.database);
    return this.store;
  }

  private embed(text: string, signal?: AbortSignal) {
    return Effect.gen({ self: this }, function* () {
      const client = this.embedding;
      if (client === undefined) return undefined;
      const failedAt = this.embeddingFailedAt;
      if (
        failedAt !== undefined &&
        currentTimeMillis() - failedAt < EMBEDDING_FAILURE_COOLDOWN_MS
      ) {
        return undefined;
      }
      return yield* fromPromise(() => client.embed(text, signal)).pipe(
        Effect.map((vector) => {
          this.embeddingFailedAt = undefined;
          this.lastEmbeddingError = undefined;
          return vector;
        }),
        Effect.catchTag("ForeignError", (failure) =>
          Effect.sync(() => {
            this.embeddingFailedAt = currentTimeMillis();
            this.lastEmbeddingError = failure.message;
            return undefined;
          }),
        ),
      );
    });
  }

  private embedDocument(text: string, signal?: AbortSignal) {
    return this.embed(`${this.settings.embedding.documentPrefix}${text}`, signal);
  }

  private embedQuery(text: string, signal?: AbortSignal) {
    return this.embed(`${this.settings.embedding.queryPrefix}${text}`, signal);
  }

  private reembedStaleEffect(limit: number) {
    return Effect.gen({ self: this }, function* () {
      if (!this.settings.enabled || this.embedding === undefined) return 0;
      let reembedded = 0;
      for (const record of this.ensureStore().listStale(this.settings.embedding.model, limit)) {
        const vector = yield* this.embedDocument(record.content);
        if (vector === undefined) break;
        this.ensureStore().setEmbedding(record.id, vector, this.settings.embedding.model);
        reembedded++;
      }
      return reembedded;
    });
  }

  private recallEffect(query: string, signal: AbortSignal | undefined) {
    return Effect.gen({ self: this }, function* () {
      if (!this.recallEnabled || query.trim() === "" || this.storeIsEmpty()) return [];
      const embedding = yield* this.embedQuery(query, signal);
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
    }).pipe(Effect.catchCause(() => Effect.succeed<MemoryRecord[]>([])));
  }

  private saveEffect(request: MemorySaveRequest) {
    return Effect.gen({ self: this }, function* () {
      const content = request.content.trim();
      if (content === "") return yield* new ToolFailure({ message: "Memory content is empty" });
      const kind = request.kind ?? "fact";
      if (!isMemoryKind(kind)) {
        return yield* new ToolFailure({
          message: `Unknown memory kind "${kind}"; use one of ${MEMORY_KINDS.join(", ")}`,
        });
      }
      const scope = request.scope ?? "project";
      if (scope !== "project" && scope !== "global") {
        return yield* new ToolFailure({
          message: `Unknown memory scope "${scope}"; use project or global`,
        });
      }
      yield* fromPromise(() => this.ready);
      const embedding = yield* this.embedDocument(content);
      const result = this.ensureStore().save({
        content,
        kind,
        project: this.project,
        scope,
        ...(embedding === undefined
          ? {}
          : { embedding, embeddingModel: this.settings.embedding.model }),
      });
      const failure = this.lastEmbeddingError;
      return {
        ...result,
        embedded: embedding !== undefined,
        ...(embedding === undefined && failure !== undefined && failure !== ""
          ? { embeddingError: failure }
          : {}),
      };
    });
  }

  private searchEffect(query: string, limit: number) {
    return Effect.gen({ self: this }, function* () {
      yield* fromPromise(() => this.ready);
      if (this.ensureStore().isEmpty()) return [];
      const embedding = yield* this.embedQuery(query);
      return this.ensureStore().search({
        text: query,
        ...(embedding === undefined ? {} : { embedding }),
        project: this.project,
        limit,
        minScore: EXPLICIT_SEARCH_MIN_SCORE,
      });
    });
  }
}
