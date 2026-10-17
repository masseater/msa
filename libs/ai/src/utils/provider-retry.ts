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

function getRetryDelayMs(
  error: ProviderError,
  retryIndex: number,
  maxRetryDelayMs: number | undefined,
): number {
  const retryAfterMs = error.headers?.get("retry-after-ms");
  if (retryAfterMs !== undefined && retryAfterMs !== null && retryAfterMs !== "") {
    const value = Number.parseFloat(retryAfterMs);
    if (Number.isFinite(value))
      return validateServerRetryDelayMs(value, maxRetryDelayMs, error.message);
  }

  const retryAfter = error.headers?.get("retry-after");
  if (retryAfter !== undefined && retryAfter !== null && retryAfter !== "") {
    const seconds = Number.parseFloat(retryAfter);
    const delayMs = Number.isNaN(seconds) ? Date.parse(retryAfter) - Date.now() : seconds * 1000;
    if (Number.isFinite(delayMs))
      return validateServerRetryDelayMs(delayMs, maxRetryDelayMs, error.message);
  }

  const exponentialDelay = Math.min(0.5 * 2 ** retryIndex, 8) * 1000;
  return exponentialDelay * (1 - Math.random() * 0.25);
}

function createAbortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(createAbortError());
      return;
    }

    const onAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };
    const timeout = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.max(0, ms),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function retryProviderRequest<T>(
  request: () => Promise<T>,
  options: ProviderRetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 0;
  let retriesRemaining = maxRetries;

  for (;;) {
    try {
      return await request();
    } catch (error) {
      if (options.signal?.aborted === true) throw createAbortError();
      if (retriesRemaining <= 0 || !isProviderError(error) || !isRetryableProviderError(error))
        throw error;
      if (error.status !== undefined && options.noRetryStatuses?.includes(error.status) === true)
        throw error;

      const retryIndex = maxRetries - retriesRemaining;
      retriesRemaining--;
      await abortableSleep(
        getRetryDelayMs(error, retryIndex, options.maxRetryDelayMs),
        options.signal,
      );
    }
  }
}
