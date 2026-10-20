import type typesModule from "../types.types.ts";
import type openrouterApiTypes from "./openrouter-api.types.ts";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function perMillion(value: string | undefined, fallback: number): number {
  const perToken = Number.parseFloat(value ?? "");
  return perToken >= 0 ? Number((perToken * 1_000_000).toFixed(6)) : fallback;
}

function openRouterCost(
  pricing: openrouterApiTypes.OpenRouterPricing | undefined,
): typesModule.ModelCost {
  const base = {
    cacheRead: perMillion(pricing?.input_cache_read, 0),
    cacheWrite: perMillion(pricing?.input_cache_write, 0),
    input: perMillion(pricing?.prompt, 0),
    output: perMillion(pricing?.completion, 0),
  };
  const tiers = (pricing?.overrides ?? []).flatMap((override): typesModule.ModelCostTier[] => {
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
        cacheRead: perMillion(override.input_cache_read, base.cacheRead),
        cacheWrite: perMillion(override.input_cache_write, base.cacheWrite),
        input: perMillion(override.prompt, base.input),
        inputTokensAbove: override.min_prompt_tokens,
        output: perMillion(override.completion, base.output),
      },
    ];
  });
  return tiers.length > 0 ? { ...base, tiers } : base;
}

const openrouterApi = {
  OPENROUTER_BASE_URL,
  openRouterCost,
};

export default openrouterApi;
