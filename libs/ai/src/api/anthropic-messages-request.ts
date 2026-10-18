import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import { Effect } from "effect";

import { currentTimeMillis } from "../utils/clock.ts";
import { appendAssistantMessageDiagnostic } from "../utils/diagnostics.ts";
import { callHook } from "../utils/hooks.ts";
import { providerRequestWithRetry } from "../utils/provider-retry.ts";
import type { TranscriptContext } from "../utils/transcript.ts";
import { buildParams } from "./anthropic-messages-params.ts";
import type { RunState } from "./anthropic-messages-run.ts";

const STRICT_TOOL_LIMIT_MESSAGES = [
  "The compiled grammar is too large",
  "Too many strict tools (",
  "Schemas contains too many parameters with union types (",
];

type ClientRequestOptions = NonNullable<Parameters<Anthropic["beta"]["messages"]["create"]>[1]>;

interface RetryDecision {
  readonly hasPreferredStrictTools: boolean;
  readonly disable: boolean;
  readonly signal: AbortSignal | undefined;
}

function shouldRetryWithoutPreferredStrictTools(error: APIError, decision: RetryDecision): boolean {
  return (
    decision.signal?.aborted !== true &&
    !decision.disable &&
    decision.hasPreferredStrictTools &&
    error.status === 400 &&
    error.type === "invalid_request_error" &&
    STRICT_TOOL_LIMIT_MESSAGES.some((message) => error.message.includes(message))
  );
}

function retryOrDie(
  error: unknown,
  run: RunState,
  decision: RetryDecision,
  retry: () => Effect.Effect<Response>,
): Effect.Effect<Response> {
  if (!(error instanceof APIError) || !shouldRetryWithoutPreferredStrictTools(error, decision)) {
    return Effect.die(error);
  }
  appendAssistantMessageDiagnostic(run.output, {
    type: "anthropic_strict_tools_fallback",
    timestamp: currentTimeMillis(),
    error: { message: error.message },
    details: { reason: "strict_tool_limits_exceeded" },
  });
  return retry();
}

interface AttemptInput {
  readonly run: RunState;
  readonly context: TranscriptContext;
  readonly isOAuth: boolean;
  readonly requestOptions: ClientRequestOptions;
  readonly disablePreferredStrictTools: boolean;
}

function attemptRequest(input: AttemptInput): Effect.Effect<Response> {
  const { run, context, isOAuth, requestOptions } = input;
  const { model, options, output } = run;
  return Effect.gen(function* () {
    options?.signal?.throwIfAborted();
    const built = buildParams({
      model,
      context,
      usesOAuth: isOAuth,
      options,
      disablePreferredStrictTools: input.disablePreferredStrictTools,
    });
    if (built.providerThinkingLevel !== undefined) {
      output.providerThinkingLevel = built.providerThinkingLevel;
    }
    let params = built.params;
    const nextParams = yield* callHook(() => options?.onPayload?.(params, model));
    if (nextParams !== undefined) {
      params = { ...(nextParams as MessageCreateParamsStreaming), stream: true };
    }
    const decision: RetryDecision = {
      hasPreferredStrictTools: built.hasPreferredStrictTools,
      disable: input.disablePreferredStrictTools,
      signal: options?.signal,
    };
    return yield* providerRequestWithRetry(
      () => run.client.beta.messages.create(params, requestOptions).asResponse(),
      {
        maxRetries: options?.maxRetries,
        maxRetryDelayMs: options?.maxRetryDelayMs,
        signal: options?.signal,
      },
    ).pipe(
      Effect.catchDefect((error) =>
        retryOrDie(error, run, decision, () =>
          attemptRequest({ ...input, disablePreferredStrictTools: true }),
        ),
      ),
    );
  });
}

interface PerformRequestInput {
  readonly run: RunState;
  readonly context: TranscriptContext;
  readonly isOAuth: boolean;
}

function performRequest(input: PerformRequestInput): Effect.Effect<Response> {
  const { run, context, isOAuth } = input;
  const { options } = run;
  return attemptRequest({
    run,
    context,
    isOAuth,
    requestOptions: {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      maxRetries: 0,
    },
    disablePreferredStrictTools: false,
  });
}

export { performRequest };
