import { Effect, Function } from "effect";

import type typesModule from "../types.types.ts";
import providerFailureModule from "./provider-failure.ts";
import type retryTypes from "./retry.types.ts";

const { isProviderUnusableError, isRetryableAssistantError, providerUnusableReason } =
  providerFailureModule;

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

const retry = {
  DEFAULT_MAX_AGENT_RETRY_DELAY_MS,
  isProviderUnusableError,
  isRetryableAssistantError,
  providerUnusableReason,
  retryAssistantCall,
  retryDelayMs,
};

export default retry;
