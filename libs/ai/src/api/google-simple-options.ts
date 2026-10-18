import { clampThinkingLevel } from "../models.ts";
import type { Model, SimpleStreamOptions, ThinkingBudgets, TranscriptContext } from "../types.ts";
import type { GoogleRequestOptions } from "./google-params.ts";
import {
  type GoogleApiType,
  type ResolvedGoogleThinkingLevel,
  resolveGoogleThinkingLevel,
  toGoogleThinkingLevel,
  usesGoogleThinkingLevel,
} from "./google-thinking.ts";
import { buildBaseOptions } from "./simple-options.ts";

export interface GoogleSimpleRequest<T extends GoogleApiType> {
  readonly model: Model<T>;
  readonly context: TranscriptContext;
  readonly options: SimpleStreamOptions | undefined;
  readonly apiKey: string | undefined;
  readonly budgetFor: (
    level: ResolvedGoogleThinkingLevel,
    customBudgets: ThinkingBudgets | undefined,
  ) => number;
}

function googleThinking<T extends GoogleApiType>({
  model,
  options,
  budgetFor,
}: GoogleSimpleRequest<T>): NonNullable<GoogleRequestOptions["thinking"]> {
  if (options?.reasoning === undefined) return { enabled: false };
  const clampedReasoning = clampThinkingLevel(model, options.reasoning);
  if (clampedReasoning === "off") return { enabled: false };
  const resolvedLevel = resolveGoogleThinkingLevel(model, clampedReasoning);
  if (usesGoogleThinkingLevel(model)) {
    return { enabled: true, level: toGoogleThinkingLevel(resolvedLevel) };
  }
  return { enabled: true, budgetTokens: budgetFor(resolvedLevel, options.thinkingBudgets) };
}

export function googleSimpleOptions<T extends GoogleApiType>(
  request: GoogleSimpleRequest<T>,
): GoogleRequestOptions {
  const { model, context, options, apiKey } = request;
  return {
    ...buildBaseOptions(model, context, options, apiKey),
    toolChoice: options?.toolChoice,
    thinking: googleThinking(request),
  };
}
