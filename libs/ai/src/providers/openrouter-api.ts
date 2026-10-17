import type { ModelCost, ModelCostTier } from "../types.ts";

export interface OpenRouterPricing {
  prompt?: string;
  completion?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  overrides?: OpenRouterPricingOverride[];
}

export interface OpenRouterPricingOverride {
  min_prompt_tokens?: number;
  utc_start?: number;
  utc_end?: number;
  utc_days?: string[];
  prompt?: string;
  completion?: string;
  input_cache_read?: string;
  input_cache_write?: string;
}

export interface OpenRouterModel {
  id: string;
  context_length?: number | null;
  top_provider?: { context_length?: number | null; max_completion_tokens?: number | null };
  pricing?: OpenRouterPricing;
}

function perMillion(value: string | undefined, fallback: number): number {
  const perToken = Number.parseFloat(value ?? "");
  return perToken >= 0 ? Number((perToken * 1_000_000).toFixed(6)) : fallback;
}

export function openRouterCost(pricing: OpenRouterPricing | undefined): ModelCost {
  const base = {
    input: perMillion(pricing?.prompt, 0),
    output: perMillion(pricing?.completion, 0),
    cacheRead: perMillion(pricing?.input_cache_read, 0),
    cacheWrite: perMillion(pricing?.input_cache_write, 0),
  };
  const tiers = (pricing?.overrides ?? []).flatMap((override): ModelCostTier[] => {
    if (
      override.min_prompt_tokens === undefined ||
      override.utc_start !== undefined ||
      override.utc_end !== undefined ||
      override.utc_days !== undefined
    ) {
      return [];
    }
    return [
      {
        inputTokensAbove: override.min_prompt_tokens,
        input: perMillion(override.prompt, base.input),
        output: perMillion(override.completion, base.output),
        cacheRead: perMillion(override.input_cache_read, base.cacheRead),
        cacheWrite: perMillion(override.input_cache_write, base.cacheWrite),
      },
    ];
  });
  return tiers.length > 0 ? { ...base, tiers } : base;
}
