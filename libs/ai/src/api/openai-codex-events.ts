import { Effect, Stream } from "effect";
import type {
  ResponseCreateParamsStreaming,
  ResponseStatus,
  ResponseStreamEvent,
} from "openai/resources/responses/responses.js";

import type { AssistantMessage, Model, Usage } from "../types.ts";
import { formatThrownValue } from "../utils/diagnostics.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { callHook } from "../utils/hooks.ts";
import { CodexStreamError } from "./openai-codex-error.ts";
import type { OpenAICodexResponsesOptions } from "./openai-codex-options.ts";
import type { CodexRawEvent } from "./openai-codex-sse.ts";
import { processResponsesStream } from "./openai-responses-stream.ts";

type ServiceTier = ResponseCreateParamsStreaming["service_tier"] | undefined;
type CodexModel = Model<"openai-codex-responses">;

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

function apiError(event: CodexRawEvent): CodexStreamError {
  const nested =
    typeof event["error"] === "object" && event["error"] !== null
      ? (event["error"] as Record<string, unknown>)
      : undefined;
  const code = stringField(event, "code") ?? stringField(nested, "code");
  const message = stringField(event, "message") ?? stringField(nested, "message");
  return new CodexStreamError({
    message: `Codex error: ${message || code || JSON.stringify(event)}`,
    kind: "api",
    code,
    payload: event,
  });
}

function failedResponseError(event: CodexRawEvent): CodexStreamError {
  const error = (event as { response?: { error?: { code?: string; message?: string } } }).response
    ?.error;
  return new CodexStreamError({
    message: error?.message || "Codex response failed",
    kind: "api",
    code: error?.code,
    payload: event,
  });
}

function completedEvent(event: CodexRawEvent, output: AssistantMessage): ResponseStreamEvent {
  const response = (event as { response?: { status?: unknown; end_turn?: unknown } }).response;
  if (typeof response?.end_turn === "boolean") output.endTurn = response.end_turn;
  const status = CODEX_RESPONSE_STATUSES.has(response?.status) ? response?.status : undefined;
  return {
    ...event,
    type: "response.completed",
    response: response === undefined ? response : { ...response, status },
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
  event: CodexRawEvent,
  output: AssistantMessage,
): ResponseStreamEvent | undefined {
  const type = stringField(event, "type");
  if (type === undefined || type === "") return undefined;
  if (type === "error") throw apiError(event);
  if (type === "response.failed") throw failedResponseError(event);
  if (TERMINAL_TYPES.has(type)) return completedEvent(event, output);
  return isResponseStreamEvent(event) ? event : undefined;
}

function serviceTierCostMultiplier(modelId: string, serviceTier: ServiceTier): number {
  if (serviceTier === "flex") return 0.5;
  if (serviceTier === "priority") return modelId === "gpt-5.5" ? 2.5 : 2;
  return 1;
}

const applyServiceTierPricing =
  (model: CodexModel) =>
  (usage: Usage, serviceTier: ServiceTier): void => {
    const multiplier = serviceTierCostMultiplier(model.id, serviceTier);
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

export interface CodexEventsRun {
  readonly model: CodexModel;
  readonly output: AssistantMessage;
  readonly events: AssistantMessageEventStream;
  readonly options: OpenAICodexResponsesOptions | undefined;
  readonly grammarToolInputProperties: ReadonlyMap<string, string>;
}

function callbackError(error: unknown): CodexStreamError {
  return new CodexStreamError({
    message: formatThrownValue(error),
    kind: "callback",
    cause: error,
  });
}

export function processCodexEvents(run: CodexEventsRun) {
  return (rawEvents: Stream.Stream<CodexRawEvent>, onFirst: () => void): Effect.Effect<void> => {
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
      serviceTier: options?.serviceTier,
      grammarToolInputProperties: run.grammarToolInputProperties,
      resolveServiceTier: resolveCodexServiceTier,
      applyServiceTierPricing: applyServiceTierPricing(model),
    });
  };
}
