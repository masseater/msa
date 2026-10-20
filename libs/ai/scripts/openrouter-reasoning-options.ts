import type { ThinkingLevelMap } from "../src/types.ts";
import getEffortThinkingLevelMap from "./models-dev-reasoning-options.ts";
import type openrouterReasoningOptionsTypes from "./openrouter-reasoning-options.types.ts";

function getOpenRouterThinkingLevelMap(
  reasoning: openrouterReasoningOptionsTypes.OpenRouterReasoningMetadata | undefined,
): ThinkingLevelMap | undefined {
  if (reasoning === undefined) return undefined;
  if (
    reasoning.supported_efforts?.length === undefined ||
    reasoning.supported_efforts?.length === 0
  )
    return reasoning.mandatory === true ? { off: null } : undefined;

  const map = getEffortThinkingLevelMap([{ type: "effort", values: reasoning.supported_efforts }]);
  if (map === undefined) return reasoning.mandatory === true ? { off: null } : undefined;
  return { ...map, off: reasoning.mandatory === true ? null : "none" };
}

export default getOpenRouterThinkingLevelMap;
