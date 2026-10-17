import { Effect, Function } from "effect";

import type { AssistantMessage } from "../types.ts";
import { waitForAbort } from "./abort.ts";

function buildProviderErrorPattern(patterns: readonly string[]): RegExp {
  return new RegExp(patterns.join("|"), "iu");
}

const NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN = buildProviderErrorPattern([
  "GoUsageLimitError",
  "FreeUsageLimitError",

  "Monthly usage limit reached",
  "available balance",

  "insufficient_quota",
  "out of budget",
  "quota exceeded",
  "billing",

  "subscription_sharing_usage_limit_exceeded",
]);

const RETRYABLE_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
  "overloaded",
  "server_busy",
  "servers are currently busy",
  "currently experiencing high demand",
  "model is at capacity",
  "rate.?limit",
  "too many requests",
  "429",
  "500",
  "502",
  "503",
  "504",
  "520",
  "524",
  "service.?(?:is.?)?(?:temporarily.?)?unavailable",
  "server.?error",
  "internal.?error",

  "provider.?returned.?(?:an.?)?error",
  "exceeded request buffer limit while retrying upstream",
  "unable to forward upstream",

  "network.?error",
  "connection.?error",
  "connection.?refused",
  "connection.?lost",
  "other side closed",
  "fetch failed",
  "getaddrinfo",
  "ENOTFOUND",
  "EAI_AGAIN",
  "upstream.?connect",
  "reset before headers",
  "socket hang up",
  "socket connection was closed",
  "timed? out",
  "timeout",
  "terminated",

  "websocket.?closed",
  "websocket.?error",

  "ended without",
  "stream ended before message_stop",
  "stream ended before a terminal response event",
  "http2 request did not get a response",
  "pending stream has been canceled",

  "retry delay",

  "you can retry your request",
  "try your request again",
  "please retry your request",

  "ResourceExhausted",

  "subscription_sharing_usage_unavailable",
  "subscription_sharing_user_unavailable",
]);

export interface RetryPolicy {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxAgentDelayMs?: number;
}

export const DEFAULT_MAX_AGENT_RETRY_DELAY_MS = 60_000;

export const retryDelayMs: {
  (attempt: number): (policy: Pick<RetryPolicy, "baseDelayMs" | "maxAgentDelayMs">) => number;
  (policy: Pick<RetryPolicy, "baseDelayMs" | "maxAgentDelayMs">, attempt: number): number;
} = Function.dual(
  2,
  (policy: Pick<RetryPolicy, "baseDelayMs" | "maxAgentDelayMs">, attempt: number): number => {
    const delay = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
    const safeDelay = Number.isSafeInteger(delay) ? delay : Number.MAX_SAFE_INTEGER;
    return Math.min(safeDelay, policy.maxAgentDelayMs ?? DEFAULT_MAX_AGENT_RETRY_DELAY_MS);
  },
);

export interface RetryCallbacks {
  onRetryScheduled?: (
    attempt: number,
    maxAttempts: number,
    delayMs: number,
    errorMessage: string,
  ) => void | Promise<void>;
  onRetryAttemptStart?: () => void | Promise<void>;
  onRetryFinished?: (
    success: boolean,
    attempt: number,
    finalError?: string,
  ) => void | Promise<void>;
}

interface RetryRun {
  readonly produce: () => Promise<AssistantMessage>;
  readonly policy: RetryPolicy | undefined;
  readonly signal: AbortSignal | undefined;
  readonly callbacks: RetryCallbacks | undefined;
  readonly maxAttempts: number;
}

interface LastRetry {
  readonly attempt: number;
  readonly errorMessage: string;
}

const awaitHook = (run: () => void | Promise<void> | undefined): Effect.Effect<void> =>
  Effect.promise(() => Promise.resolve(run()));

const sleepOrAbort = (delayMs: number, signal: AbortSignal | undefined): Effect.Effect<boolean> =>
  signal === undefined
    ? Effect.sleep(delayMs).pipe(Effect.as(false))
    : waitForAbort(signal).pipe(
        Effect.as(true),
        Effect.timeoutOrElse({ duration: delayMs, orElse: () => Effect.succeed(false) }),
      );

const settle = (
  run: RetryRun,
  response: AssistantMessage,
  lastRetry: LastRetry | undefined,
): Effect.Effect<AssistantMessage> => {
  if (lastRetry === undefined) return Effect.succeed(response);
  const finished = run.callbacks?.onRetryFinished;
  if (response.stopReason === "aborted")
    return awaitHook(() => finished?.(false, lastRetry.attempt)).pipe(Effect.as(response));
  if (response.stopReason !== "error")
    return awaitHook(() => finished?.(true, lastRetry.attempt)).pipe(Effect.as(response));
  return awaitHook(() => finished?.(false, lastRetry.attempt, response.errorMessage)).pipe(
    Effect.as(response),
  );
};

const attemptAssistantCall = (
  run: RetryRun,
  attempt: number,
  lastRetry: LastRetry | undefined,
): Effect.Effect<AssistantMessage> =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() => run.produce());
    if (
      response.stopReason !== "error" ||
      attempt >= run.maxAttempts ||
      !isRetryableAssistantError(response)
    )
      return yield* settle(run, response, lastRetry);

    const nextAttempt = attempt + 1;
    const errorMessage =
      response.errorMessage === undefined || response.errorMessage === ""
        ? "Unknown error"
        : response.errorMessage;
    const delayMs = retryDelayMs(run.policy!, nextAttempt);
    yield* awaitHook(() =>
      run.callbacks?.onRetryScheduled?.(nextAttempt, run.maxAttempts, delayMs, errorMessage),
    );

    if (yield* sleepOrAbort(delayMs, run.signal)) {
      yield* awaitHook(() => run.callbacks?.onRetryFinished?.(false, nextAttempt, errorMessage));
      const { errorMessage: _errorMessage, ...rest } = response;
      return { ...rest, stopReason: "aborted" as const };
    }
    yield* awaitHook(() => run.callbacks?.onRetryAttemptStart?.());
    return yield* attemptAssistantCall(run, nextAttempt, { attempt: nextAttempt, errorMessage });
  });

export const retryAssistantCall: {
  (
    policy: RetryPolicy | undefined,
    signal: AbortSignal | undefined,
    callbacks?: RetryCallbacks,
  ): (produce: () => Promise<AssistantMessage>) => Promise<AssistantMessage>;
  (
    produce: () => Promise<AssistantMessage>,
    policy: RetryPolicy | undefined,
    signal: AbortSignal | undefined,
    callbacks?: RetryCallbacks,
  ): Promise<AssistantMessage>;
} = Function.dual(
  (args) => typeof args[0] === "function",
  (
    produce: () => Promise<AssistantMessage>,
    policy: RetryPolicy | undefined,
    signal: AbortSignal | undefined,
    callbacks?: RetryCallbacks,
  ): Promise<AssistantMessage> =>
    Effect.runPromise(
      attemptAssistantCall(
        {
          produce,
          policy,
          signal,
          callbacks,
          maxAttempts: policy?.enabled === true ? policy.maxRetries : 0,
        },
        0,
        undefined,
      ),
    ),
);

export const isRetryableAssistantError = (message: AssistantMessage): boolean => {
  if (
    message.stopReason !== "error" ||
    message.errorMessage === undefined ||
    message.errorMessage === ""
  )
    return false;
  const errorMessage = message.errorMessage;
  if (NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN.test(errorMessage)) return false;
  return RETRYABLE_PROVIDER_ERROR_PATTERN.test(errorMessage);
};
