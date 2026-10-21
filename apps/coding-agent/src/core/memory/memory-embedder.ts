import { Effect } from "effect";

import platform from "../platform/index.ts";
import EmbeddingClient from "./embeddings.ts";
import type memoryTypesTypes from "./memory-types.ts";

const { fromPromise, nowMs } = platform;

const EMBEDDING_FAILURE_COOLDOWN_MS = 60_000;

type EmbeddingSettings = memoryTypesTypes.ResolvedMemorySettings["embedding"];

export default class MemoryEmbedder {
  private readonly settings: EmbeddingSettings;
  private readonly client: EmbeddingClient | undefined;
  private failedAt: number | undefined;
  private failure: string | undefined;

  constructor(settings: EmbeddingSettings) {
    this.settings = settings;
    if (!settings.enabled) return;
    const { apiKey } = settings;
    this.client = new EmbeddingClient({
      baseUrl: settings.baseUrl,
      model: settings.model,
      ...(apiKey !== undefined && apiKey !== "" ? { apiKey } : {}),
      timeoutMs: settings.timeoutMs,
    });
  }

  get available(): boolean {
    return this.client !== undefined;
  }

  get lastError(): string | undefined {
    return this.failure;
  }

  embedDocument(text: string, signal?: AbortSignal) {
    return this.embed(`${this.settings.documentPrefix}${text}`, signal);
  }

  embedQuery(text: string, signal?: AbortSignal) {
    return this.embed(`${this.settings.queryPrefix}${text}`, signal);
  }

  private embed(text: string, signal?: AbortSignal) {
    return Effect.gen({ self: this }, function* () {
      const { client, failedAt } = this;
      if (client === undefined) return undefined;
      if (failedAt !== undefined && nowMs() - failedAt < EMBEDDING_FAILURE_COOLDOWN_MS) {
        return undefined;
      }
      return yield* fromPromise(() => client.embed(text, signal)).pipe(
        Effect.map((vector) => {
          this.failedAt = undefined;
          this.failure = undefined;
          return vector;
        }),
        Effect.catchTag("ForeignError", (failure) =>
          Effect.sync(() => {
            this.failedAt = nowMs();
            this.failure = failure.message;
            return undefined;
          }),
        ),
      );
    });
  }
}
