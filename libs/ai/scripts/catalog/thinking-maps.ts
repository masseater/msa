import { Function } from "effect";

import type { Model } from "../../src/types.ts";
import {
  getEffortThinkingLevelMap,
  type ModelsDevReasoningOption,
} from "../models-dev-reasoning-options.ts";
import type { ThinkingLevelMap } from "./models-dev.ts";

export const DEEPSEEK_V4_THINKING_LEVEL_MAP = {
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  max: "max",
} as const;

export const DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP = {
  ...DEEPSEEK_V4_THINKING_LEVEL_MAP,
  low: "low",
} as const;

export const AZURE_DEEPSEEK_V4_THINKING_LEVEL_MAP = {
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: null,
} as const;

export const mergeThinkingLevelMap: {
  (map: ThinkingLevelMap): (model: Model<any>) => void;
  (model: Model<any>, map: ThinkingLevelMap): void;
} = Function.dual(2, (model: Model<any>, map: ThinkingLevelMap): void => {
  model.thinkingLevelMap = { ...model.thinkingLevelMap, ...map };
});

function isGemma4Model(modelId: string): boolean {
  return /gemma-?4/u.test(modelId.toLowerCase());
}

export const getGoogleThinkingLevelMap: {
  (
    reasoningOptions: readonly ModelsDevReasoningOption[],
  ): (modelId: string) => ThinkingLevelMap | undefined;
  (
    modelId: string,
    reasoningOptions: readonly ModelsDevReasoningOption[],
  ): ThinkingLevelMap | undefined;
} = Function.dual(
  2,
  (
    modelId: string,
    reasoningOptions: readonly ModelsDevReasoningOption[],
  ): ThinkingLevelMap | undefined => {
    const effortMap = getEffortThinkingLevelMap(reasoningOptions);
    if (effortMap !== undefined) return effortMap;
    if (isGemma4Model(modelId)) {
      return { off: null, minimal: "MINIMAL", low: null, medium: null, high: "HIGH" };
    }
    return undefined;
  },
);
