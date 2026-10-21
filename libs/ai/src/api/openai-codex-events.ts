import { Effect, Stream } from "effect";
import type {
  ResponseCreateParamsStreaming,
  ResponseStatus,
  ResponseStreamEvent,
} from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import diagnosticsModule from "../utils/diagnostics.ts";
import hooks from "../utils/hooks.ts";
import openaiCodexError from "./openai-codex-error.ts";
import type openaiCodexErrorTypes from "./openai-codex-error.types.ts";
import type openaiCodexEventsTypes from "./openai-codex-events.types.ts";
import type openaiCodexSseTypes from "./openai-codex-sse.types.ts";
import openaiResponsesStream from "./openai-responses-stream.ts";

const { CodexStreamError } = openaiCodexError;
const { formatThrownValue } = diagnosticsModule;
const { callHook } = hooks;
const { processResponsesStream } = openaiResponsesStream;

type ServiceTier = ResponseCreateParamsStreaming["service_tier"] | undefined;

const CODEX_RESPONSE_STATUSES: ReadonlySet<unknown> = new Set<ResponseStatus>([
  "completed",
  "incomplete",
  "failed",
  "cancelled",
  "queued",
  "in_progress",
]);

const TERMINAL_TYPES = new Set(["response.done", "response.completed", "response.incomplete"]);

const stringField = (source: Record<string, unknown> | undefined, key: string) =>
  typeof source?.[key] === "string" ? source[key] : undefined;

function apiError(
  event: openaiCodexSseTypes.CodexRawEvent,
): openaiCodexErrorTypes.CodexStreamError {
  const nested =
    typeof event["error"] === "object" && event["error"] !== null
      ? (event["error"] as Record<string, unknown>)
      : undefined;
  const code = stringField(event, "code") ?? stringField(nested, "code");
  const message = stringField(event, "message") ?? stringField(nested, "message");
  return new CodexStreamError({
    code,
    kind: "api",
    message: `Codex error: ${message || code || JSON.stringify(event)}`,
    payload: event,
  });
}

function failedResponseError(
  event: openaiCodexSseTypes.CodexRawEvent,
): openaiCodexErrorTypes.CodexStreamError {
  const error = (event as { response?: { error?: { code?: string; message?: string } } }).response
    ?.error;
  return new CodexStreamError({
    code: error?.code,
    kind: "api",
    message: error?.message || "Codex response failed",
    payload: event,
  });
}

function completedEvent(
  event: openaiCodexSseTypes.CodexRawEvent,
  output: typesModule.AssistantMessage,
): ResponseStreamEvent {
  const response = (event as { response?: { status?: unknown; end_turn?: unknown } }).response;
  if (typeof response?.end_turn === "boolean") output.endTurn = response.end_turn;
  const status = CODEX_RESPONSE_STATUSES.has(response?.status) ? response?.status : undefined;
  return {
    ...event,
    response: response === undefined ? response : { ...response, status },
    type: "response.completed",
  } as ResponseStreamEvent;
}

function isResponseStreamEvent(event: unknown): event is ResponseStreamEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    typeof (event as { type?: unknown }).type === "string"
  );
}

function mapCodexEvent(
  event: openaiCodexSseTypes.CodexRawEvent,
  output: typesModule.AssistantMessage,
): ResponseStreamEvent | undefined {
  const type = stringField(event, "type");
  if (type === undefined || type === "") return undefined;
  if (type === "error") throw apiError(event);
  if (type === "response.failed") throw failedResponseError(event);
  if (TERMINAL_TYPES.has(type)) return completedEvent(event, output);
  return isResponseStreamEvent(event) ? event : undefined;
}

function serviceTierCostMultiplier(
  model: openaiCodexEventsTypes.CodexModel,
  serviceTier: ServiceTier,
): number {
  if (serviceTier === "flex") return model.cost.serviceTiers?.flex ?? 1;
  if (serviceTier === "priority") return model.cost.serviceTiers?.priority ?? 1;
  return 1;
}

const applyServiceTierPricing =
  (model: openaiCodexEventsTypes.CodexModel) =>
  (usage: typesModule.Usage, serviceTier: ServiceTier): void => {
    const multiplier = serviceTierCostMultiplier(model, serviceTier);
    if (multiplier === 1) return;
    const cost = usage.cost;
    cost.input *= multiplier;
    cost.output *= multiplier;
    cost.cacheRead *= multiplier;
    cost.cacheWrite *= multiplier;
    cost.total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite;
  };

function resolveCodexServiceTier(response: ServiceTier, request: ServiceTier): ServiceTier {
  if (response === "default" && (request === "flex" || request === "priority")) return request;
  return response ?? request;
}

function callbackError(error: unknown): openaiCodexErrorTypes.CodexStreamError {
  return new CodexStreamError({
    cause: error,
    kind: "callback",
    message: formatThrownValue(error),
  });
}

function processCodexEvents(run: openaiCodexEventsTypes.CodexEventsRun) {
  return (
    rawEvents: Stream.Stream<openaiCodexSseTypes.CodexRawEvent>,
    onFirst: () => void,
  ): Effect.Effect<void> => {
    const { model, output, options } = run;
    const events = rawEvents.pipe(
      Stream.mapEffect((event) =>
        callHook(() => options?.onProviderStreamEvent?.(event, model)).pipe(
          Effect.catchDefect((error) => Effect.die(callbackError(error))),
          Effect.andThen(Effect.sync(() => mapCodexEvent(event, output))),
        ),
      ),
      Stream.filter((event): event is ResponseStreamEvent => event !== undefined),
      Stream.takeUntil((event) => event.type === "response.completed"),
      Stream.onFirst(() => Effect.sync(onFirst)),
    );
    return processResponsesStream(events, output, run.events, model, {
      applyServiceTierPricing: applyServiceTierPricing(model),
      grammarToolInputProperties: run.grammarToolInputProperties,
      resolveServiceTier: resolveCodexServiceTier,
      serviceTier: options?.serviceTier,
    });
  };
}

const openaiCodexEvents = {
  processCodexEvents,
};

export default openaiCodexEvents;
