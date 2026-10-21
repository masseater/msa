import { ThinkingLevel as GoogleSdkThinkingLevel, type ThinkingConfig } from "@google/genai";
import { Function } from "effect";

import modelsModule from "../models.ts";
import type typesModule from "../types.types.ts";
import type googleThinkingTypes from "./google-thinking.types.ts";

const { clampThinkingLevel } = modelsModule;

const GOOGLE_SDK_THINKING_LEVEL_MAP: Record<
  googleThinkingTypes.GoogleApiThinkingLevel,
  GoogleSdkThinkingLevel
> = {
  HIGH: GoogleSdkThinkingLevel.HIGH,
  LOW: GoogleSdkThinkingLevel.LOW,
  MEDIUM: GoogleSdkThinkingLevel.MEDIUM,
  MINIMAL: GoogleSdkThinkingLevel.MINIMAL,
  THINKING_LEVEL_UNSPECIFIED: GoogleSdkThinkingLevel.THINKING_LEVEL_UNSPECIFIED,
};

const resolveGoogleThinkingLevel: {
  <T extends googleThinkingTypes.GoogleApiType>(
    level: typesModule.ThinkingLevel,
  ): (model: typesModule.Model<T>) => googleThinkingTypes.ResolvedGoogleThinkingLevel;
  <T extends googleThinkingTypes.GoogleApiType>(
    model: typesModule.Model<T>,
    level: typesModule.ThinkingLevel,
  ): googleThinkingTypes.ResolvedGoogleThinkingLevel;
} = Function.dual(2, function <
  T extends googleThinkingTypes.GoogleApiType,
>(model: typesModule.Model<T>, level: typesModule.ThinkingLevel): googleThinkingTypes.ResolvedGoogleThinkingLevel {
  const mapped = model.thinkingLevelMap?.[level];
  const resolvedLevel = typeof mapped === "string" ? mapped.toLowerCase() : level;
  switch (resolvedLevel) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
      return resolvedLevel;
    default:
      throw new Error(
        `Unsupported Google thinking level mapping for ${model.provider}/${model.id}: ${level} -> ${String(mapped)}`,
      );
  }
});

function usesGoogleThinkingLevel<T extends googleThinkingTypes.GoogleApiType>(
  model: typesModule.Model<T>,
): boolean {
  const id = model.id.toLowerCase();
  return (
    /gemini-3(?:\.\d+)?-(?:pro|flash)/u.test(id) ||
    /gemini-(?:[4-9]|[1-9]\d)/u.test(id) ||
    id === "gemini-flash-latest" ||
    id === "gemini-flash-lite-latest" ||
    /gemma-?4/u.test(id)
  );
}

function toGoogleThinkingLevel(
  level: googleThinkingTypes.ResolvedGoogleThinkingLevel,
): googleThinkingTypes.GoogleApiThinkingLevel {
  switch (level) {
    case "minimal":
      return "MINIMAL";
    case "low":
      return "LOW";
    case "medium":
      return "MEDIUM";
    case "high":
      return "HIGH";
  }
}

function toGoogleSdkThinkingLevel(
  level: googleThinkingTypes.GoogleApiThinkingLevel,
): GoogleSdkThinkingLevel {
  return GOOGLE_SDK_THINKING_LEVEL_MAP[level];
}

function getDisabledGoogleThinkingConfig<T extends googleThinkingTypes.GoogleApiType>(
  model: typesModule.Model<T>,
): ThinkingConfig {
  if (!usesGoogleThinkingLevel(model)) return { thinkingBudget: 0 };

  const fallback = clampThinkingLevel(model, "off");
  if (fallback === "off") return { thinkingBudget: 0 };

  const resolvedLevel = resolveGoogleThinkingLevel(model, fallback);
  const apiLevel = toGoogleThinkingLevel(resolvedLevel);
  return { thinkingLevel: toGoogleSdkThinkingLevel(apiLevel) };
}

const googleThinking = {
  getDisabledGoogleThinkingConfig,
  resolveGoogleThinkingLevel,
  toGoogleSdkThinkingLevel,
  toGoogleThinkingLevel,
  usesGoogleThinkingLevel,
};

export default googleThinking;
