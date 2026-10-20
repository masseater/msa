declare namespace openaiCompletionsPromptCacheMockTypes {
  interface FakeOpenAIClientOptions {
    apiKey: string;
    baseURL: string;
    dangerouslyAllowBrowser: boolean;
    defaultHeaders?: Record<string, string>;
  }

  interface CapturedCompletionsPayload {
    prompt_cache_key?: string;
    prompt_cache_retention?: "24h" | "in-memory" | null;
    session_id?: string;
  }
}

export type { openaiCompletionsPromptCacheMockTypes as default };
