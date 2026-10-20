import type storeTypesTypes from "./store-types.types.ts";

declare namespace memoryTypesTypes {
  interface ResolvedMemorySettings {
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

  interface MemoryServiceOptions {
    settings: ResolvedMemorySettings;
    cwd: string;
    project?: string;
  }

  interface MemorySaveRequest {
    content: string;
    kind?: storeTypesTypes.MemoryKind;
    scope?: storeTypesTypes.MemoryScope;
  }

  interface MemorySaveOutcome extends storeTypesTypes.MemorySaveResult {
    embedded: boolean;
    embeddingError?: string;
  }
}

export type { memoryTypesTypes as default };
