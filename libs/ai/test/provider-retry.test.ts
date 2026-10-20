import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import providerRetry from "../src/utils/provider-retry.ts";

const { retryProviderRequest } = providerRetry;

function providerError(status: number | undefined, headers?: Record<string, string>): Error {
  return Object.assign(new Error(`Provider error: ${status}`), {
    headers: new Headers(headers),
    status,
  });
}

describe("provider request retries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("retries retryable provider errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const request = vi
          .fn<() => Promise<string>>()
          .mockRejectedValueOnce(providerError(429, { "retry-after-ms": "1000" }))
          .mockResolvedValue("ok");

        const result = retryProviderRequest(request, { maxRetries: 1 });
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(999));
        expect(request).toHaveBeenCalledTimes(1);
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));

        yield* Effect.promise(() => expect(result).resolves.toBe("ok"));
        expect(request).toHaveBeenCalledTimes(2);
      }),
    ));

  it("does not retry errors the provider marks as non-retryable", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const error = providerError(429, { "x-should-retry": "false" });
        const request = vi.fn<() => Promise<string>>().mockRejectedValue(error);

        yield* Effect.promise(() =>
          expect(retryProviderRequest(request, { maxRetries: 2 })).rejects.toBe(error),
        );
        expect(request).toHaveBeenCalledTimes(1);
      }),
    ));
});

describe("provider request retries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("does not retry statuses listed in noRetryStatuses", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const error = providerError(504, { "retry-after-ms": "0" });
        const request = vi.fn<() => Promise<string>>().mockRejectedValue(error);

        yield* Effect.promise(() =>
          expect(
            retryProviderRequest(request, { maxRetries: 2, noRetryStatuses: [504] }),
          ).rejects.toBe(error),
        );
        expect(request).toHaveBeenCalledTimes(1);
      }),
    ));
});

describe("provider request retries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("rejects a provider-requested retry delay above the limit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const request = vi
          .fn<() => Promise<string>>()
          .mockRejectedValue(providerError(429, { "retry-after": "277403" }));

        yield* Effect.promise(() =>
          expect(
            retryProviderRequest(request, { maxRetries: 1, maxRetryDelayMs: 1000 }),
          ).rejects.toThrow("Server requested 277403s retry delay (max: 1s)"),
        );
        expect(request).toHaveBeenCalledTimes(1);
      }),
    ));

  it("allows disabling the provider-requested retry delay cap", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const request = vi
          .fn<() => Promise<string>>()
          .mockRejectedValueOnce(providerError(429, { "retry-after": "2" }))
          .mockResolvedValue("ok");

        const result = retryProviderRequest(request, { maxRetries: 1, maxRetryDelayMs: 0 });
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1999));
        expect(request).toHaveBeenCalledTimes(1);
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));

        yield* Effect.promise(() => expect(result).resolves.toBe("ok"));
        expect(request).toHaveBeenCalledTimes(2);
      }),
    ));
});

describe("provider request retries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("aborts a provider-requested retry delay", () => {
    const controller = new AbortController();
    return Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const request = vi
          .fn<() => Promise<string>>()
          .mockRejectedValue(providerError(429, { "retry-after": "277403" }));

        const result = retryProviderRequest(request, {
          maxRetries: 2,
          maxRetryDelayMs: 0,
          signal: controller.signal,
        });
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
        expect(request).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);

        controller.abort();

        yield* Effect.promise(() => expect(result).rejects.toMatchObject({ name: "AbortError" }));
        expect(request).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      }),
    );
  });
});
