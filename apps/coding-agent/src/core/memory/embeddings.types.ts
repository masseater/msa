import type EmbeddingClientClass from "./embeddings.ts";

declare namespace embeddingsTypes {
  interface EmbeddingClientOptions {
    baseUrl: string;
    model: string;
    apiKey?: string;
    timeoutMs: number;
  }

  type EmbeddingClient = (typeof EmbeddingClientClass)["prototype"];
}

export type { embeddingsTypes as default };
