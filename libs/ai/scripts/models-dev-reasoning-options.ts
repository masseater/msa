import type { ThinkingLevel, ThinkingLevelMap } from "../src/types.ts";
import type modelsDevReasoningOptionsTypes from "./models-dev-reasoning-options.types.ts";

const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function getEffortThinkingLevelMap(
  options: readonly modelsDevReasoningOptionsTypes.ModelsDevReasoningOption[],
): ThinkingLevelMap | undefined {
  const effortValues = options.flatMap((option) => (option.type === "effort" ? option.values : []));
  if (effortValues.length === 0) return undefined;

  const supported = new Set(effortValues);
  if (!THINKING_LEVELS.some((level) => supported.has(level)) && !supported.has("none"))
    return undefined;

  const map: ThinkingLevelMap = { off: supported.has("none") ? "none" : null };
  for (const level of THINKING_LEVELS) {
    map[level] = supported.has(level) ? level : null;
  }
  return map;
}

export default getEffortThinkingLevelMap;
