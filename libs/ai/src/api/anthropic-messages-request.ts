import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import { Effect } from "effect";

import clock from "../utils/clock.ts";
import diagnosticsModule from "../utils/diagnostics.ts";
import hooks from "../utils/hooks.ts";
import providerRetry from "../utils/provider-retry.ts";
import type transcriptTypes from "../utils/transcript.types.ts";
import anthropicMessagesParams from "./anthropic-messages-params.ts";
import type anthropicMessagesRunTypes from "./anthropic-messages-run.types.ts";

const { appendAssistantMessageDiagnostic } = diagnosticsModule;
const { currentTimeMillis } = clock;
const { buildParams } = anthropicMessagesParams;
const { callHook } = hooks;
const { providerRequestWithRetry } = providerRetry;

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
  run: anthropicMessagesRunTypes.RunState,
  decision: RetryDecision,
  retry: () => Effect.Effect<Response>,
): Effect.Effect<Response> {
  if (!(error instanceof APIError) || !shouldRetryWithoutPreferredStrictTools(error, decision)) {
    return Effect.die(error);
  }
  appendAssistantMessageDiagnostic(run.output, {
    details: { reason: "strict_tool_limits_exceeded" },
    error: { message: error.message },
    timestamp: currentTimeMillis(),
    type: "anthropic_strict_tools_fallback",
  });
  return retry();
}

interface AttemptInput {
  readonly run: anthropicMessagesRunTypes.RunState;
  readonly context: transcriptTypes.TranscriptContext;
  readonly requestOptions: ClientRequestOptions;
  readonly disablePreferredStrictTools: boolean;
}

function attemptRequest(input: AttemptInput): Effect.Effect<Response> {
  const { run, context, requestOptions } = input;
  const { model, options, output } = run;
  return Effect.gen(function* () {
    options?.signal?.throwIfAborted();
    const built = buildParams({
      context,
      disablePreferredStrictTools: input.disablePreferredStrictTools,
      model,
      options,
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
      disable: input.disablePreferredStrictTools,
      hasPreferredStrictTools: built.hasPreferredStrictTools,
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
  readonly run: anthropicMessagesRunTypes.RunState;
  readonly context: transcriptTypes.TranscriptContext;
}

function performRequest(input: PerformRequestInput): Effect.Effect<Response> {
  const { run, context } = input;
  const { options } = run;
  return attemptRequest({
    context,
    disablePreferredStrictTools: false,
    requestOptions: {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      maxRetries: 0,
    },
    run,
  });
}

const anthropicMessagesRequest = {
  performRequest,
};

export default anthropicMessagesRequest;
