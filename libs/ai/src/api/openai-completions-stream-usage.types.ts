declare namespace openaiCompletionsStreamUsageTypes {
  interface RawUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    cached_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  }
}

export type { openaiCompletionsStreamUsageTypes as default };
