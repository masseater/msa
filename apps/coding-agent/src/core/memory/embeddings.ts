/**
 * Embedding client for OpenAI-compatible `/embeddings` endpoints, which covers local runtimes
 * (Ollama, LM Studio, llama.cpp) and hosted APIs with one code path. Vectors are L2-normalized
 * before they are stored, so ranking only needs a dot product.
 */

export interface EmbeddingClientOptions {
  /** Base URL such as `http://127.0.0.1:11434/v1`. `/embeddings` is appended. */
  baseUrl: string;
  model: string;
  /** Bearer token, when the endpoint requires one. */
  apiKey?: string;
  timeoutMs: number;
}

export class EmbeddingClient {
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private dimension: number | undefined;

  constructor(options: EmbeddingClientOptions) {
    this.endpoint = `${options.baseUrl.replace(/\/+$/, "")}/embeddings`;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
  }

  /** The width of the vectors this endpoint returns, known after the first successful call. */
  get dimensions(): number | undefined {
    return this.dimension;
  }

  async embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) controller.abort(signal.reason);
    else signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error(`Embedding request timed out after ${this.timeoutMs} ms`)),
      this.timeoutMs,
    );
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.model, input: text }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Embedding endpoint ${this.endpoint} answered ${response.status}: ${body.slice(0, 200)}`,
        );
      }
      const payload = (await response.json()) as {
        data?: Array<{ embedding?: unknown }>;
      };
      const values = payload.data?.[0]?.embedding;
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error(`Embedding endpoint ${this.endpoint} returned no vector`);
      }
      const vector = new Float32Array(values.length);
      let norm = 0;
      for (let index = 0; index < values.length; index++) {
        const value = Number(values[index]);
        if (!Number.isFinite(value)) {
          throw new Error(`Embedding endpoint ${this.endpoint} returned a non-finite value`);
        }
        vector[index] = value;
        norm += value * value;
      }
      if (norm === 0) throw new Error(`Embedding endpoint ${this.endpoint} returned a zero vector`);
      const scale = 1 / Math.sqrt(norm);
      for (let index = 0; index < vector.length; index++) vector[index]! *= scale;
      if (this.dimension !== undefined && this.dimension !== vector.length) {
        throw new Error(
          `Embedding endpoint ${this.endpoint} changed dimension from ${this.dimension} to ${vector.length}; clear or re-embed stored memories`,
        );
      }
      this.dimension = vector.length;
      return vector;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
