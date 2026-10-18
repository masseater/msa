import { Effect } from "effect";

import { headersToRecord } from "../utils/headers.ts";
import { callHook } from "../utils/hooks.ts";
import { compressRequestBodyZstd } from "./openai-codex-compress.ts";
import { requestAbortedError } from "./openai-codex-error.ts";
import { processCodexEvents } from "./openai-codex-events.ts";
import {
  BASE_DELAY_MS,
  describeCodexErrorBody,
  getRetryAfterDelayMs,
  isRetryableError,
  RetryDelayExceededError,
  sleepUnless,
  validateRetryDelayMs,
} from "./openai-codex-retry.ts";
import { type CodexSseRequest, fetchCodexSseResponse } from "./openai-codex-sse-fetch.ts";
import { readCodexSseEvents } from "./openai-codex-sse.ts";
import { type CodexStreamRun, finishCodexOutput } from "./openai-codex-stream-run.ts";

const DEFAULT_MAX_RETRIES = 0;

const attemptCodexSse = Effect.fn("attemptCodexSse")(function* (
  request: CodexSseRequest,
  attempt: number,
) {
  const { run } = request;
  const response = yield* fetchCodexSseResponse(request);
  const head = { status: response.status, headers: headersToRecord(response.headers) };
  yield* callHook(() => run.options?.onResponse?.(head, run.model));
  if (response.ok) return response;
  const errorText = yield* Effect.promise(() => response.text());
  if (attempt < request.maxRetries && isRetryableError({ status: response.status, errorText })) {
    const retryAfter = getRetryAfterDelayMs(response.headers);
    const delayMs =
      retryAfter === undefined
        ? BASE_DELAY_MS * 2 ** attempt
        : validateRetryDelayMs(run.options)(retryAfter);
    yield* sleepUnless(run.options?.signal)(delayMs);
    return undefined;
  }
  const info = describeCodexErrorBody(response)(errorText);
  throw new Error(info.friendlyMessage || info.message);
});

function retryCodexSseAttempt(
  request: CodexSseRequest,
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

function requestCodexSse(request: CodexSseRequest, attempt: number): Effect.Effect<Response> {
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

export const streamCodexOverSse = Effect.fn("streamCodexOverSse")(function* (run: CodexStreamRun) {
  const compressed = compressRequestBodyZstd(run.bodyJson);
  if (compressed !== null) run.sseHeaders.set("content-encoding", "zstd");
  const maxRetries = run.options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const response = yield* requestCodexSse({ run, body: compressed ?? run.bodyJson, maxRetries }, 0);
  if (response.body === null) throw new Error("No response body");
  run.emitStart();
  yield* processCodexEvents(run)(readCodexSseEvents(run.options?.signal)(response), run.emitStart);
  finishCodexOutput(run);
});
