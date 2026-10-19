import { httpRequest } from "@msa/ai/utils/http";
import { Duration, Effect, Schema } from "effect";

import { platformRuntime, ToolFailure } from "../platform/index.ts";

export interface EmbeddingClientOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
}

interface EmbeddingPayload {
  data?: Array<{ embedding?: unknown }>;
}

function normalizedVector(values: unknown, endpoint: string): Float32Array {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Embedding endpoint ${endpoint} returned no vector`);
  }
  const vector = new Float32Array(values.length);
  let norm = 0;
  for (const [index, raw] of values.entries()) {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`Embedding endpoint ${endpoint} returned a non-finite value`);
    }
    vector[index] = value;
    norm += value * value;
  }
  if (norm === 0) throw new Error(`Embedding endpoint ${endpoint} returned a zero vector`);
  const scale = 1 / Math.sqrt(norm);
  return vector.map((value) => value * scale);
}

interface EmbeddingRequest {
  endpoint: string;
  model: string;
  apiKey: string | undefined;
  text: string;
  signal: AbortSignal | undefined;
}

const requestVector = Effect.fn("requestEmbedding")(function* (request: EmbeddingRequest) {
  const { endpoint, apiKey } = request;
  const body = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
    model: request.model,
    input: request.text,
  }).pipe(Effect.orDie);
  const reply = yield* httpRequest({
    url: endpoint,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey !== undefined && apiKey !== "" ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body,
    signal: request.signal,
  });
  if (!reply.ok) {
    const text = yield* reply.text.pipe(Effect.orElseSucceed(() => ""));
    return yield* new ToolFailure({
      message: `Embedding endpoint ${endpoint} answered ${reply.status}: ${text.slice(0, 200)}`,
    });
  }
  const payload = (yield* reply.json) as EmbeddingPayload;
  return yield* Effect.sync(() => normalizedVector(payload.data?.[0]?.embedding, endpoint));
});

export class EmbeddingClient {
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private dimension: number | undefined;

  constructor(options: EmbeddingClientOptions) {
    this.endpoint = `${options.baseUrl.replace(/\/+$/u, "")}/embeddings`;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
  }

  get dimensions(): number | undefined {
    return this.dimension;
  }

  embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
    return platformRuntime.runPromise(
      requestVector({
        endpoint: this.endpoint,
        model: this.model,
        apiKey: this.apiKey,
        text,
        signal,
      }).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(this.timeoutMs),
          orElse: () =>
            Effect.fail(
              new ToolFailure({
                message: `Embedding request timed out after ${this.timeoutMs} ms`,
              }),
            ),
        }),
        Effect.flatMap((vector) => this.acceptVector(vector)),
      ),
    );
  }

  private acceptVector(vector: Float32Array) {
    if (this.dimension !== undefined && this.dimension !== vector.length) {
      return Effect.fail(
        new ToolFailure({
          message: `Embedding endpoint ${this.endpoint} changed dimension from ${this.dimension} to ${vector.length}; clear or re-embed stored memories`,
        }),
      );
    }
    this.dimension = vector.length;
    return Effect.succeed(vector);
  }
}
