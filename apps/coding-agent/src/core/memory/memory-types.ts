import type { MemoryKind, MemoryScope, MemorySaveResult } from "./store-types.ts";

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
