import { Effect, Function } from "effect";

import type typesModule from "../types.types.ts";
import type retryTypes from "./retry.types.ts";

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

const PROVIDER_ACCOUNT_STATUSES: ReadonlySet<number> = new Set([401, 402, 403]);

const RETRYABLE_PROVIDER_STATUSES: ReadonlySet<number> = new Set([
  429, 500, 502, 503, 504, 520, 524,
]);

const HTTP_STATUS_PATTERNS: readonly RegExp[] = [
  /^\s*(\d{3})(?=[\s:]|$)/u,
  /^[^\n(]*\((\d{3})\):/u,
  /\bstatus(?:\s+code)?\s*[:=]?\s*(\d{3})\b/iu,
  /"(?:code|status)"\s*:\s*(\d{3})\b/u,
];

const httpStatus = (text: string): number | undefined => {
  for (const pattern of HTTP_STATUS_PATTERNS) {
    const status = pattern.exec(text)?.[1];
    if (status !== undefined) return Number(status);
  }
  return undefined;
};

const PROVIDER_ACCOUNT_ERROR_PATTERN = buildProviderErrorPattern([
  "payment.?required",
  "requires more credits",
  "credit balance",
  "insufficient.?(?:credits|balance|funds)",
  "invalid.?(?:credential|api.?key|x-api-key)",
  "unauthorized",
  "authentication.?error",
  "permission.?denied",
]);

const RETRYABLE_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
  "overloaded",
  "server_busy",
  "servers are currently busy",
  "currently experiencing high demand",
  "model is at capacity",
  "rate.?limit",
  "too many requests",
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

const DEFAULT_MAX_AGENT_RETRY_DELAY_MS = 60_000;

const retryDelayMs: {
  (
    attempt: number,
  ): (policy: Pick<retryTypes.RetryPolicy, "baseDelayMs" | "maxAgentDelayMs">) => number;
  (
    policy: Pick<retryTypes.RetryPolicy, "baseDelayMs" | "maxAgentDelayMs">,
    attempt: number,
  ): number;
} = Function.dual(
  2,
  (
    policy: Pick<retryTypes.RetryPolicy, "baseDelayMs" | "maxAgentDelayMs">,
    attempt: number,
  ): number => {
    const delay = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
    const safeDelay = Number.isSafeInteger(delay) ? delay : Number.MAX_SAFE_INTEGER;
    return Math.min(safeDelay, policy.maxAgentDelayMs ?? DEFAULT_MAX_AGENT_RETRY_DELAY_MS);
  },
);

interface RetryRun {
  readonly produce: () => Promise<typesModule.AssistantMessage>;
  readonly policy: retryTypes.RetryPolicy | undefined;
  readonly signal: AbortSignal | undefined;
  readonly callbacks: retryTypes.RetryCallbacks | undefined;
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
    : Effect.callback<void>((resume) => {
        const onAbort = () => resume(Effect.void);
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        return Effect.sync(() => signal.removeEventListener("abort", onAbort));
      }).pipe(
        Effect.as(true),
        Effect.timeoutOrElse({ duration: delayMs, orElse: () => Effect.succeed(false) }),
      );

const settle = (
  run: RetryRun,
  response: typesModule.AssistantMessage,
  lastRetry: LastRetry | undefined,
): Effect.Effect<typesModule.AssistantMessage> => {
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
): Effect.Effect<typesModule.AssistantMessage> =>
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

const retryAssistantCall: {
  (
    policy: retryTypes.RetryPolicy | undefined,
    signal: AbortSignal | undefined,
    callbacks?: retryTypes.RetryCallbacks,
  ): (
    produce: () => Promise<typesModule.AssistantMessage>,
  ) => Promise<typesModule.AssistantMessage>;
  (
    produce: () => Promise<typesModule.AssistantMessage>,
    policy: retryTypes.RetryPolicy | undefined,
    signal: AbortSignal | undefined,
    callbacks?: retryTypes.RetryCallbacks,
  ): Promise<typesModule.AssistantMessage>;
} = Function.dual(
  (args) => typeof args[0] === "function",
  (
    produce: () => Promise<typesModule.AssistantMessage>,
    policy: retryTypes.RetryPolicy | undefined,
    signal: AbortSignal | undefined,
    callbacks?: retryTypes.RetryCallbacks,
  ): Promise<typesModule.AssistantMessage> =>
    Effect.runPromise(
      attemptAssistantCall(
        {
          callbacks,
          maxAttempts: policy?.enabled === true ? policy.maxRetries : 0,
          policy,
          produce,
          signal,
        },
        0,
        undefined,
      ),
    ),
);

const errorText = (message: typesModule.AssistantMessage): string | undefined =>
  message.stopReason !== "error" ||
  message.errorMessage === undefined ||
  message.errorMessage === ""
    ? undefined
    : message.errorMessage;

const isProviderUnusableError = (message: typesModule.AssistantMessage): boolean => {
  const text = errorText(message);
  return (
    text !== undefined &&
    (NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN.test(text) ||
      PROVIDER_ACCOUNT_STATUSES.has(httpStatus(text) ?? 0) ||
      PROVIDER_ACCOUNT_ERROR_PATTERN.test(text))
  );
};

const isRetryableAssistantError = (message: typesModule.AssistantMessage): boolean => {
  const text = errorText(message);
  if (text === undefined || isProviderUnusableError(message)) return false;
  return (
    RETRYABLE_PROVIDER_STATUSES.has(httpStatus(text) ?? 0) ||
    RETRYABLE_PROVIDER_ERROR_PATTERN.test(text)
  );
};

const retry = {
  DEFAULT_MAX_AGENT_RETRY_DELAY_MS,
  isProviderUnusableError,
  isRetryableAssistantError,
  retryAssistantCall,
  retryDelayMs,
};

export default retry;
