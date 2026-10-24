import { Effect } from "effect";

import openaiCodexError from "./openai-codex-error.ts";
import openaiCodexEvents from "./openai-codex-events.ts";
import openaiCodexRetry from "./openai-codex-retry.ts";
import openaiCodexSseFetch from "./openai-codex-sse-fetch.ts";
import type openaiCodexSseFetchTypes from "./openai-codex-sse-fetch.types.ts";
import openaiCodexSseTransportKit from "./openai-codex-sse-transport-kit.ts";
import openaiCodexSse from "./openai-codex-sse.ts";
import openaiCodexStreamRun from "./openai-codex-stream-run.ts";
import type openaiCodexStreamRunTypes from "./openai-codex-stream-run.types.ts";

const { headers: headersModule, hooks, openaiCodexCompress } = openaiCodexSseTransportKit;

const { fetchCodexSseResponse } = openaiCodexSseFetch;
const { headersToRecord } = headersModule;
const { callHook } = hooks;
const {
  BASE_DELAY_MS,
  RetryDelayExceededError,
  describeCodexErrorBody,
  getRetryAfterDelayMs,
  isRetryableError,
  sleepUnless,
  validateRetryDelayMs,
} = openaiCodexRetry;
const { requestAbortedError } = openaiCodexError;
const { compressRequestBodyZstd } = openaiCodexCompress;
const { processCodexEvents } = openaiCodexEvents;
const { readCodexSseEvents } = openaiCodexSse;
const { finishCodexOutput } = openaiCodexStreamRun;

const DEFAULT_MAX_RETRIES = 0;

const attemptCodexSse = Effect.fn("attemptCodexSse")(function* (
  request: openaiCodexSseFetchTypes.CodexSseRequest,
  attempt: number,
) {
  const { run } = request;
  const response = yield* fetchCodexSseResponse(request);
  const head = { headers: headersToRecord(response.headers), status: response.status };
  yield* callHook(() => run.options?.onResponse?.(head, run.model));
  if (response.ok) return response;
  const errorText = yield* Effect.promise(() => response.text());
  if (attempt < request.maxRetries && isRetryableError({ errorText, status: response.status })) {
    const retryAfter = getRetryAfterDelayMs(response.headers);
    const delayMs =
      retryAfter === undefined
        ? BASE_DELAY_MS * 2 ** attempt
        : validateRetryDelayMs(run.options)(retryAfter);
    yield* sleepUnless(run.options?.signal)(delayMs);
    return undefined;
  }
  const info = describeCodexErrorBody(response)(errorText);
  throw Object.assign(new Error(info.friendlyMessage || info.message), { status: response.status });
});

function retryCodexSseAttempt(
  request: openaiCodexSseFetchTypes.CodexSseRequest,
  attempt: number,
  error: unknown,
): Effect.Effect<Response | undefined> {
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.message === "Request was aborted")
  ) {
    return Effect.die(new Error("Request was aborted", { cause: error }));
  }
  const lastError = error instanceof Error ? error : new Error(String(error));
  const retryable =
    attempt < request.maxRetries &&
    !(lastError instanceof RetryDelayExceededError) &&
    !lastError.message.includes("usage limit");
  if (!retryable) return Effect.die(lastError);
  return sleepUnless(request.run.options?.signal)(BASE_DELAY_MS * 2 ** attempt).pipe(
    Effect.as(undefined),
  );
}

function requestCodexSse(
  request: openaiCodexSseFetchTypes.CodexSseRequest,
  attempt: number,
): Effect.Effect<Response> {
  if (attempt > request.maxRetries) return Effect.die(new Error("Failed after retries"));
  return Effect.suspend(() => {
    if (request.run.options?.signal?.aborted === true) return Effect.die(requestAbortedError());
    return attemptCodexSse(request, attempt).pipe(
      Effect.catchDefect((error) => retryCodexSseAttempt(request, attempt, error)),
      Effect.filterOrElse(
        (response): response is Response => response !== undefined,
        () => requestCodexSse(request, attempt + 1),
      ),
    );
  });
}

const streamCodexOverSse = Effect.fn("streamCodexOverSse")(function* (
  run: openaiCodexStreamRunTypes.CodexStreamRun,
) {
  const compressed = compressRequestBodyZstd(run.bodyJson);
  if (compressed !== null) run.sseHeaders.set("content-encoding", "zstd");
  const maxRetries = run.options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const response = yield* requestCodexSse({ body: compressed ?? run.bodyJson, maxRetries, run }, 0);
  if (response.body === null) throw new Error("No response body");
  run.emitStart();
  yield* processCodexEvents(run)(readCodexSseEvents(run.options?.signal)(response), run.emitStart);
  finishCodexOutput(run);
});

const openaiCodexSseTransport = {
  streamCodexOverSse,
};

export default openaiCodexSseTransport;
