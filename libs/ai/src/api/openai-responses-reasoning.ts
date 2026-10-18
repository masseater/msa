import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type { ReasoningEffort } from "openai/resources/shared.js";

import { clampThinkingLevel } from "../models.ts";
import type {
  Api,
  Model,
  SimpleStreamOptions,
  StreamOptions,
  TranscriptContext,
} from "../types.ts";
import { buildBaseOptions, resolveSamplingParams } from "./simple-options.ts";

export interface ResponsesReasoningOptions extends StreamOptions {
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  reasoningSummary?: "auto" | "detailed" | "concise" | null | undefined;
  toolChoice?: ResponseCreateParamsStreaming["tool_choice"] | undefined;
}

export interface ReasoningRequest<TApi extends Api> {
  readonly model: Model<TApi>;
  readonly options: ResponsesReasoningOptions | undefined;
  readonly effortOverride?: string | undefined;
}

function requestedEffort(options: ResponsesReasoningOptions | undefined) {
  const summary = options?.reasoningSummary;
  return (
    options?.reasoningEffort ?? (summary !== undefined && summary !== null ? "medium" : undefined)
  );
}

function reasoningParams<TApi extends Api>({
  model,
  options,
  effortOverride,
}: ReasoningRequest<TApi>): Pick<ResponseCreateParamsStreaming, "reasoning" | "include"> {
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
    reasoning: {
      effort: (effortOverride ?? requested) as ReasoningEffort,
      summary: options?.reasoningSummary || "auto",
    },
    include: ["reasoning.encrypted_content"],
  };
}

export function applyReasoningParams(params: ResponseCreateParamsStreaming) {
  return <TApi extends Api>(request: ReasoningRequest<TApi>): void => {
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

export interface SimpleResponsesRequest<TApi extends Api> {
  readonly model: Model<TApi>;
  readonly context: TranscriptContext;
  readonly options: SimpleStreamOptions | undefined;
  readonly apiKey: string | undefined;
}

export function responsesSimpleOptions<TApi extends Api>({
  model,
  context,
  options,
  apiKey,
}: SimpleResponsesRequest<TApi>): ResponsesReasoningOptions {
  const clamped =
    options?.reasoning === undefined ? undefined : clampThinkingLevel(model, options.reasoning);
  return {
    ...buildBaseOptions(model, context, options, apiKey),
    toolChoice: options?.toolChoice,
    reasoningEffort: clamped === "off" ? undefined : clamped,
  };
}
