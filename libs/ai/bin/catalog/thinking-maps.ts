import { Function } from "effect";

import type typesModule from "../../src/types.types.ts";
import getEffortThinkingLevelMap from "../models-dev-reasoning-options.ts";
import type modelsDevReasoningOptionsTypes from "../models-dev-reasoning-options.types.ts";
import type modelsDevTypes from "./models-dev.types.ts";

const DEEPSEEK_V4_THINKING_LEVEL_MAP = {
  high: "high",
  low: null,
  max: "max",
  medium: null,
  minimal: null,
} as const;

const DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP = {
  ...DEEPSEEK_V4_THINKING_LEVEL_MAP,
  low: "low",
} as const;

const mergeThinkingLevelMap: {
  (map: modelsDevTypes.ThinkingLevelMap): (model: typesModule.Model<any>) => void;
  (model: typesModule.Model<any>, map: modelsDevTypes.ThinkingLevelMap): void;
} = Function.dual(
  2,
  (model: typesModule.Model<any>, map: modelsDevTypes.ThinkingLevelMap): void => {
    model.thinkingLevelMap = { ...model.thinkingLevelMap, ...map };
  },
);

function isGemma4Model(modelId: string): boolean {
  return /gemma-?4/u.test(modelId.toLowerCase());
}

const getGoogleThinkingLevelMap: {
  (
    reasoningOptions: readonly modelsDevReasoningOptionsTypes.ModelsDevReasoningOption[],
  ): (modelId: string) => modelsDevTypes.ThinkingLevelMap | undefined;
  (
    modelId: string,
    reasoningOptions: readonly modelsDevReasoningOptionsTypes.ModelsDevReasoningOption[],
  ): modelsDevTypes.ThinkingLevelMap | undefined;
} = Function.dual(
  2,
  (
    modelId: string,
    reasoningOptions: readonly modelsDevReasoningOptionsTypes.ModelsDevReasoningOption[],
  ): modelsDevTypes.ThinkingLevelMap | undefined => {
    const effortMap = getEffortThinkingLevelMap(reasoningOptions);
    if (effortMap !== undefined) return effortMap;
    if (isGemma4Model(modelId)) {
      return { high: "HIGH", low: null, medium: null, minimal: "MINIMAL", off: null };
    }
    return undefined;
  },
);

const thinkingMaps = {
  DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP,
  DEEPSEEK_V4_THINKING_LEVEL_MAP,
  getGoogleThinkingLevelMap,
  mergeThinkingLevelMap,
};

export default thinkingMaps;
