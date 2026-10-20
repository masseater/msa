declare namespace openrouterApiTypes {
  interface OpenRouterPricing {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
    overrides?: OpenRouterPricingOverride[];
  }

  interface OpenRouterPricingOverride {
    min_prompt_tokens?: number;
    utc_start?: number;
    utc_end?: number;
    utc_days?: string[];
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  }

  interface OpenRouterModel {
    id: string;
    context_length?: number | null;
    top_provider?: { context_length?: number | null; max_completion_tokens?: number | null };
    pricing?: OpenRouterPricing;
  }
}

export type { openrouterApiTypes as default };
