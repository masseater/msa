import modelsModule from "../models.ts";
import type googleParamsTypes from "./google-params.types.ts";
import type googleSimpleOptionsTypes from "./google-simple-options.types.ts";
import googleThinkingModule from "./google-thinking.ts";
import type googleThinkingTypes from "./google-thinking.types.ts";
import simpleOptions from "./simple-options.ts";

const { clampThinkingLevel } = modelsModule;
const { resolveGoogleThinkingLevel, toGoogleThinkingLevel, usesGoogleThinkingLevel } =
  googleThinkingModule;
const { buildBaseOptions } = simpleOptions;

function googleThinking<T extends googleThinkingTypes.GoogleApiType>({
  model,
  options,
  budgetFor,
}: googleSimpleOptionsTypes.GoogleSimpleRequest<T>): NonNullable<
  googleParamsTypes.GoogleRequestOptions["thinking"]
> {
  if (options?.reasoning === undefined) return { enabled: false };
  const clampedReasoning = clampThinkingLevel(model, options.reasoning);
  if (clampedReasoning === "off") return { enabled: false };
  const resolvedLevel = resolveGoogleThinkingLevel(model, clampedReasoning);
  if (usesGoogleThinkingLevel(model)) {
    return { enabled: true, level: toGoogleThinkingLevel(resolvedLevel) };
  }
  return { budgetTokens: budgetFor(resolvedLevel, options.thinkingBudgets), enabled: true };
}

function googleSimpleOptions<T extends googleThinkingTypes.GoogleApiType>(
  request: googleSimpleOptionsTypes.GoogleSimpleRequest<T>,
): googleParamsTypes.GoogleRequestOptions {
  const { model, context, options, apiKey } = request;
  return {
    ...buildBaseOptions(model, context, options, apiKey),
    thinking: googleThinking(request),
    toolChoice: options?.toolChoice,
  };
}

const googleSimpleOptionsModule = {
  googleSimpleOptions,
};

export default googleSimpleOptionsModule;
