import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Fiber, FileSystem, ManagedRuntime } from "effect";

import platform from "../platform/index.ts";
import EmbeddingClient from "./embeddings.ts";
import type embeddingsTypes from "./embeddings.types.ts";
import memoryFormat from "./memory-format.ts";
import memoryProject from "./memory-project.ts";
import MemoryStore from "./memory-store.ts";
import type memoryTypesTypes from "./memory-types.ts";
import storeTypesModule from "./store-types.ts";
import type storeTypes from "./store.types.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { projectNameOf } = memoryProject;
const { formatMemoryStats, formatMemoryStatus, isMemoryKind } = memoryFormat;
const { MEMORY_KINDS } = storeTypesModule;
const { ToolFailure, currentTimeMillis, fromPromise, pathOperations, unwrapForeign } = platform;

const EMBEDDING_FAILURE_COOLDOWN_MS = 60_000;
const REEMBED_BATCH_LIMIT = 25;
const EXPLICIT_SEARCH_MIN_SCORE = 0.1;
export default class MemoryService {
  readonly settings: memoryTypesTypes.ResolvedMemorySettings;
  private projectName: string;
  private store: storeTypes.MemoryStore | undefined;
  private embedding: embeddingsTypes.EmbeddingClient | undefined;
  private embeddingFailedAt: number | undefined;
  private lastEmbeddingError: string | undefined;
  private readonly ready: Promise<void>;
  private readonly preparing: Fiber.Fiber<void>;
  private closed = false;
  private warming: Fiber.Fiber<void> | undefined;

  constructor(options: memoryTypesTypes.MemoryServiceOptions) {
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
    this.preparing = nodeRuntime.runFork(this.prepare(options));
    this.ready = nodeRuntime.runPromise(Effect.asVoid(Fiber.await(this.preparing)));
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
    this.warming = nodeRuntime.runFork(
      this.embedQuery("warmup").pipe(
        Effect.andThen(this.reembedStaleEffect(REEMBED_BATCH_LIMIT)),
        Effect.ignore,
      ),
    );
  }

  reembedStale(limit = REEMBED_BATCH_LIMIT): Promise<number> {
    return nodeRuntime.runPromise(unwrapForeign(this.reembedStaleEffect(limit)));
  }

  recall(query: string, signal?: AbortSignal): Promise<storeTypes.MemoryRecord[]> {
    return nodeRuntime.runPromise(this.recallEffect(query, signal));
  }

  save(request: memoryTypesTypes.MemorySaveRequest): Promise<memoryTypesTypes.MemorySaveOutcome> {
    return nodeRuntime.runPromise(unwrapForeign(this.saveEffect(request)));
  }

  search(query: string, limit = 5): Promise<storeTypes.MemoryScore[]> {
    return nodeRuntime.runPromise(unwrapForeign(this.searchEffect(query, limit)));
  }

  list(limit = 20): storeTypes.MemoryRecord[] {
    return this.ensureStore().list({ limit, project: this.project });
  }

  stats(): storeTypes.MemoryStoreStats {
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

  close(): Promise<void> {
    this.closed = true;
    const warming = this.warming;
    this.warming = undefined;
    this.store?.close();
    this.store = undefined;
    const background = warming === undefined ? [this.preparing] : [this.preparing, warming];
    return nodeRuntime.runPromise(Fiber.interruptAll(background));
  }

  private prepare(options: memoryTypesTypes.MemoryServiceOptions) {
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

  private ensureStore(): storeTypes.MemoryStore {
    if (this.closed) throw new Error("Memory service is closed");
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
        limit: this.settings.recall.limit,
        minScore: this.settings.recall.minScore,
        project: this.project,
      });
      const records = scores.map((scored) => scored.record);
      if (records.length > 0) this.ensureStore().markUsed(records.map((record) => record.id));
      return records;
    }).pipe(Effect.catchCause(() => Effect.succeed<storeTypes.MemoryRecord[]>([])));
  }

  private saveEffect(request: memoryTypesTypes.MemorySaveRequest) {
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
        limit,
        minScore: EXPLICIT_SEARCH_MIN_SCORE,
        project: this.project,
      });
    });
  }
}
