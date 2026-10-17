import { Clock, DateTime, Effect, Function, Option, Random } from "effect";

import { sleepUnlessAborted } from "./abort.ts";

const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;

interface ProviderRetryOptions {
  maxRetries?: number | undefined;
  maxRetryDelayMs?: number | undefined;
  signal?: AbortSignal | undefined;
  noRetryStatuses?: readonly number[] | undefined;
}

interface ProviderError extends Error {
  status: number | undefined;
  headers: Headers | undefined;
}

function isProviderError(error: unknown): error is ProviderError {
  if (!(error instanceof Error) || !("status" in error) || !("headers" in error)) return false;
  return (
    (error.status === undefined || typeof error.status === "number") &&
    (error.headers === undefined || error.headers instanceof Headers)
  );
}

function isRetryableProviderError(error: ProviderError): boolean {
  const shouldRetry = error.headers?.get("x-should-retry");
  if (shouldRetry === "true") return true;
  if (shouldRetry === "false") return false;

  if (error.status === undefined) return true;
  return (
    error.status === 408 ||
    error.status === 409 ||
    error.status === 429 ||
    (typeof error.status === "number" && error.status >= 500)
  );
}

function validateServerRetryDelayMs(
  delayMs: number,
  maxRetryDelayMs: number | undefined,
  providerErrorMessage: string,
): number {
  const maxDelayMs = maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  if (maxDelayMs > 0 && delayMs > maxDelayMs) {
    throw new Error(
      `Server requested ${Math.ceil(delayMs / 1000)}s retry delay (max: ${Math.ceil(maxDelayMs / 1000)}s). ${providerErrorMessage}`,
    );
  }
  return delayMs;
}
const parseHeaderNumber = (
  error: ProviderError,
  name: "retry-after-ms" | "retry-after",
): string | undefined => {
  const value = error.headers?.get(name);
  return value === undefined || value === null || value === "" ? undefined : value;
};

const getRetryDelayMs = (
  error: ProviderError,
  retryIndex: number,
  maxRetryDelayMs: number | undefined,
): Effect.Effect<number> =>
  Effect.gen(function* () {
    const retryAfterMs = parseHeaderNumber(error, "retry-after-ms");
    if (retryAfterMs !== undefined) {
      const value = Number.parseFloat(retryAfterMs);
      if (Number.isFinite(value))
        return validateServerRetryDelayMs(value, maxRetryDelayMs, error.message);
    }

    const retryAfter = parseHeaderNumber(error, "retry-after");
    if (retryAfter !== undefined) {
      const seconds = Number.parseFloat(retryAfter);
      const delayMs = Number.isNaN(seconds)
        ? Option.match(DateTime.make(retryAfter), {
            onNone: () => Number.NaN,
            onSome: DateTime.toEpochMillis,
          }) - (yield* Clock.currentTimeMillis)
        : seconds * 1000;
      if (Number.isFinite(delayMs))
        return validateServerRetryDelayMs(delayMs, maxRetryDelayMs, error.message);
    }

    const exponentialDelay = Math.min(0.5 * 2 ** retryIndex, 8) * 1000;
    return exponentialDelay * (1 - (yield* Random.next) * 0.25);
  });

const createAbortError = (): Error => {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
};

interface ProviderRetryRun<T> {
  readonly request: () => Promise<T>;
  readonly options: ProviderRetryOptions;
  readonly maxRetries: number;
}

const attemptProviderRequest = <T>(
  run: ProviderRetryRun<T>,
  retriesRemaining: number,
): Effect.Effect<T> =>
  Effect.promise(() => run.request()).pipe(
    Effect.catchDefect((error) =>
      Effect.gen(function* () {
        if (run.options.signal?.aborted === true) return yield* Effect.die(createAbortError());
        if (retriesRemaining <= 0 || !isProviderError(error) || !isRetryableProviderError(error))
          return yield* Effect.die(error);
        if (
          error.status !== undefined &&
          run.options.noRetryStatuses?.includes(error.status) === true
        )
          return yield* Effect.die(error);

        const retryIndex = run.maxRetries - retriesRemaining;
        const delayMs = yield* getRetryDelayMs(error, retryIndex, run.options.maxRetryDelayMs);
        yield* sleepUnlessAborted(Math.max(0, delayMs), run.options.signal, createAbortError);
        return yield* attemptProviderRequest(run, retriesRemaining - 1);
      }),
    ),
  );

export const providerRequestWithRetry: {
  (options?: ProviderRetryOptions): <T>(request: () => Promise<T>) => Effect.Effect<T>;
  <T>(request: () => Promise<T>, options?: ProviderRetryOptions): Effect.Effect<T>;
} = Function.dual(
  (args) => typeof args[0] === "function",
  <T>(request: () => Promise<T>, options: ProviderRetryOptions = {}): Effect.Effect<T> => {
    const maxRetries = options.maxRetries ?? 0;
    return attemptProviderRequest({ request, options, maxRetries }, maxRetries);
  },
);

export const retryProviderRequest: {
  (options?: ProviderRetryOptions): <T>(request: () => Promise<T>) => Promise<T>;
  <T>(request: () => Promise<T>, options?: ProviderRetryOptions): Promise<T>;
} = Function.dual(
  (args) => typeof args[0] === "function",
  <T>(request: () => Promise<T>, options?: ProviderRetryOptions): Promise<T> =>
    Effect.runPromise(providerRequestWithRetry(request, options)),
);
