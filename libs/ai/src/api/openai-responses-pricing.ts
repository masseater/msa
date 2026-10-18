import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type { Model, Usage } from "../types.ts";

type ServiceTier = ResponseCreateParamsStreaming["service_tier"] | undefined;

function serviceTierCostMultiplier(modelId: string, serviceTier: ServiceTier): number {
  switch (serviceTier) {
    case "flex":
      return 0.5;
    case "priority":
    case "fast":
      return modelId === "gpt-5.5" ? 2.5 : 2;
    default:
      return 1;
  }
}

export function serviceTierPricing(
  model: Pick<Model<"openai-responses">, "id">,
): (usage: Usage, serviceTier: ServiceTier) => void {
  return (usage, serviceTier) => {
    const multiplier = serviceTierCostMultiplier(model.id, serviceTier);
    if (multiplier === 1) return;
    const cost = usage.cost;
    cost.input *= multiplier;
    cost.output *= multiplier;
    cost.cacheRead *= multiplier;
    cost.cacheWrite *= multiplier;
    cost.total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite;
  };
}
