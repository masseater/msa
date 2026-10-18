import { ThinkingLevel as GoogleSdkThinkingLevel, type ThinkingConfig } from "@google/genai";
import { Function } from "effect";

import { clampThinkingLevel } from "../models.ts";
import type { Model, ThinkingLevel } from "../types.ts";

export type GoogleApiType = "google-generative-ai";

export type GoogleApiThinkingLevel =
  | "THINKING_LEVEL_UNSPECIFIED"
  | "MINIMAL"
  | "LOW"
  | "MEDIUM"
  | "HIGH";
export type ResolvedGoogleThinkingLevel = Exclude<ThinkingLevel, "xhigh" | "max">;

const GOOGLE_SDK_THINKING_LEVEL_MAP: Record<GoogleApiThinkingLevel, GoogleSdkThinkingLevel> = {
  THINKING_LEVEL_UNSPECIFIED: GoogleSdkThinkingLevel.THINKING_LEVEL_UNSPECIFIED,
  MINIMAL: GoogleSdkThinkingLevel.MINIMAL,
  LOW: GoogleSdkThinkingLevel.LOW,
  MEDIUM: GoogleSdkThinkingLevel.MEDIUM,
  HIGH: GoogleSdkThinkingLevel.HIGH,
};

export const resolveGoogleThinkingLevel: {
  <T extends GoogleApiType>(level: ThinkingLevel): (model: Model<T>) => ResolvedGoogleThinkingLevel;
  <T extends GoogleApiType>(model: Model<T>, level: ThinkingLevel): ResolvedGoogleThinkingLevel;
} = Function.dual(2, function <
  T extends GoogleApiType,
>(model: Model<T>, level: ThinkingLevel): ResolvedGoogleThinkingLevel {
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

export function usesGoogleThinkingLevel<T extends GoogleApiType>(model: Model<T>): boolean {
  const id = model.id.toLowerCase();
  return (
    /gemini-3(?:\.\d+)?-(?:pro|flash)/u.test(id) ||
    /gemini-(?:[4-9]|[1-9]\d)/u.test(id) ||
    id === "gemini-flash-latest" ||
    id === "gemini-flash-lite-latest" ||
    /gemma-?4/u.test(id)
  );
}

export function toGoogleThinkingLevel(level: ResolvedGoogleThinkingLevel): GoogleApiThinkingLevel {
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

export function toGoogleSdkThinkingLevel(level: GoogleApiThinkingLevel): GoogleSdkThinkingLevel {
  return GOOGLE_SDK_THINKING_LEVEL_MAP[level];
}

export function getDisabledGoogleThinkingConfig<T extends GoogleApiType>(
  model: Model<T>,
): ThinkingConfig {
  if (!usesGoogleThinkingLevel(model)) return { thinkingBudget: 0 };

  const fallback = clampThinkingLevel(model, "off");
  if (fallback === "off") return { thinkingBudget: 0 };

  const resolvedLevel = resolveGoogleThinkingLevel(model, fallback);
  const apiLevel = toGoogleThinkingLevel(resolvedLevel);
  return { thinkingLevel: toGoogleSdkThinkingLevel(apiLevel) };
}
