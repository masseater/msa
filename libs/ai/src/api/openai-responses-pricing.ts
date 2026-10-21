import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";

type ServiceTier = ResponseCreateParamsStreaming["service_tier"] | undefined;

function serviceTierCostMultiplier(
  tiers: typesModule.Model<"openai-responses">["cost"]["serviceTiers"],
  serviceTier: ServiceTier,
): number {
  switch (serviceTier) {
    case "flex":
      return tiers?.flex ?? 1;
    case "priority":
    case "fast":
      return tiers?.priority ?? 1;
    default:
      return 1;
  }
}

function serviceTierPricing(
  model: Pick<typesModule.Model<"openai-responses">, "cost">,
): (usage: typesModule.Usage, serviceTier: ServiceTier) => void {
  return (usage, serviceTier) => {
    const multiplier = serviceTierCostMultiplier(model.cost.serviceTiers, serviceTier);
    if (multiplier === 1) return;
    const cost = usage.cost;
    cost.input *= multiplier;
    cost.output *= multiplier;
    cost.cacheRead *= multiplier;
    cost.cacheWrite *= multiplier;
    cost.total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite;
  };
}

const openaiResponsesPricing = {
  serviceTierPricing,
};

export default openaiResponsesPricing;
