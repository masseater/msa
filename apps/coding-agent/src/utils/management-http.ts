import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../core/awaiting.ts";
type FetchInput = Parameters<typeof fetch>[0];

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface FetchRetryOptions {
  maxRetries?: number;

  retryOnStatus?: boolean;

  timeoutMs?: number;

  attemptTimeoutMs?: number;
}

export function fetchWithRetry(
  input: FetchInput,
  init: RequestInit | undefined = undefined,
  options: FetchRetryOptions = {},
): Promise<Response> {
  return Effect.runPromise(
    awaiting(function* () {
      const maxRetries =
        options.maxRetries === undefined || !Number.isFinite(options.maxRetries)
          ? 2
          : Math.max(0, Math.floor(options.maxRetries));
      const retryOnStatus = options.retryOnStatus ?? true;
      const parentSignal = init?.signal ?? undefined;
      const timeoutSignal =
        options.timeoutMs !== undefined && options.timeoutMs > 0
          ? AbortSignal.timeout(options.timeoutMs)
          : undefined;
      const attemptTimeoutMs =
        options.attemptTimeoutMs !== undefined && options.attemptTimeoutMs > 0
          ? options.attemptTimeoutMs
          : undefined;

      for (let attempt = 0; ; attempt++) {
        parentSignal?.throwIfAborted();
        timeoutSignal?.throwIfAborted();
        const attemptTimeoutSignal =
          attemptTimeoutMs !== undefined && attemptTimeoutMs !== 0
            ? AbortSignal.timeout(attemptTimeoutMs)
            : undefined;
        const signals = [parentSignal, timeoutSignal, attemptTimeoutSignal].filter(
          (signal): signal is AbortSignal => signal !== undefined,
        );
        const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

        try {
          const response = yield* awaited(
            fetch(input, signal === undefined ? init : { ...init, signal }),
          );
          const shouldRetry =
            retryOnStatus && RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxRetries;
          if (!shouldRetry) return response;
          try {
            yield* awaited(response.body?.cancel());
          } catch {}
        } catch (error) {
          const attemptTimedOut =
            attemptTimeoutSignal?.aborted === true &&
            parentSignal?.aborted !== true &&
            timeoutSignal?.aborted !== true;
          if (
            parentSignal?.aborted === true ||
            timeoutSignal?.aborted === true ||
            (error instanceof Error &&
              error.name === "AbortError" &&
              !attemptTimedOut &&
              timeoutSignal === undefined) ||
            attempt >= maxRetries
          ) {
            throw error;
          }
        }
      }
    }),
  );
}
