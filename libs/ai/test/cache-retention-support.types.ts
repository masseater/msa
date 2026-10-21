declare namespace cacheRetentionSupportTypes {
  interface AnthropicCachePayload {
    readonly system?: readonly { readonly cache_control?: unknown }[];
    readonly messages: readonly {
      readonly role: string;
      readonly content: string | readonly { readonly cache_control?: unknown }[];
    }[];
  }

  interface OpenAICompletionsCachePayload {
    readonly prompt_cache_key?: string;
    readonly prompt_cache_retention?: string;
  }

  interface OpenAIResponsesCachePayload extends OpenAICompletionsCachePayload {
    readonly prompt_cache_options?: { readonly mode?: "explicit"; readonly ttl?: "30m" };
  }
}

export type { cacheRetentionSupportTypes as default };
