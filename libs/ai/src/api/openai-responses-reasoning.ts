import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type { ReasoningEffort } from "openai/resources/shared.js";

import modelsModule from "../models.ts";
import type typesModule from "../types.types.ts";
import type openaiResponsesReasoningTypes from "./openai-responses-reasoning.types.ts";
import simpleOptions from "./simple-options.ts";

const { buildBaseOptions, resolveSamplingParams } = simpleOptions;
const { clampThinkingLevel } = modelsModule;

function requestedEffort(
  options: openaiResponsesReasoningTypes.ResponsesReasoningOptions | undefined,
) {
  const summary = options?.reasoningSummary;
  return (
    options?.reasoningEffort ?? (summary !== undefined && summary !== null ? "medium" : undefined)
  );
}

function reasoningParams<TApi extends typesModule.Api>({
  model,
  options,
  effortOverride,
}: openaiResponsesReasoningTypes.ReasoningRequest<TApi>): Pick<
  ResponseCreateParamsStreaming,
  "reasoning" | "include"
> {
  const effort = requestedEffort(options);
  if (effort === undefined) {
    const off = model.thinkingLevelMap?.off;
    return off === null ? {} : { reasoning: { effort: (off ?? "none") as ReasoningEffort } };
  }
  const requested =
    options?.reasoningEffort === undefined
      ? effort
      : (model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort);
  return {
    include: ["reasoning.encrypted_content"],
    reasoning: {
      effort: (effortOverride ?? requested) as ReasoningEffort,
      summary: options?.reasoningSummary || "auto",
    },
  };
}

function applyReasoningParams(params: ResponseCreateParamsStreaming) {
  return <TApi extends typesModule.Api>(
    request: openaiResponsesReasoningTypes.ReasoningRequest<TApi>,
  ): void => {
    const { model, options } = request;
    if (model.reasoning) Object.assign(params, reasoningParams(request));
    const sampling = resolveSamplingParams(
      model,
      requestedEffort(options) ?? "off",
      options?.samplingParams,
    );
    if (sampling !== undefined) Object.assign(params, sampling);
  };
}

function responsesSimpleOptions<TApi extends typesModule.Api>({
  model,
  context,
  options,
  apiKey,
}: openaiResponsesReasoningTypes.SimpleResponsesRequest<TApi>): openaiResponsesReasoningTypes.ResponsesReasoningOptions {
  const clamped =
    options?.reasoning === undefined ? undefined : clampThinkingLevel(model, options.reasoning);
  return {
    ...buildBaseOptions(model, context, options, apiKey),
    reasoningEffort: clamped === "off" ? undefined : clamped,
    toolChoice: options?.toolChoice,
  };
}

const openaiResponsesReasoning = {
  applyReasoningParams,
  responsesSimpleOptions,
};

export default openaiResponsesReasoning;
