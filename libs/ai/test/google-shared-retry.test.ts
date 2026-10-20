import { Effect, Fiber } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { retryGoogleRequest } from "../src/api/google-shared.ts";
import effectAssert from "./effect-assert.ts";

const { defectOf } = effectAssert;

function googleApiError(status: number): Error {
  return Object.assign(new Error(`got status: ${status}`), { status });
}

describe("google request retries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a headers-less SDK error with a retryable status", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        const request = vi
          .fn<() => Promise<string>>()
          .mockRejectedValueOnce(googleApiError(429))
          .mockResolvedValue("ok");

        const result = yield* Effect.forkChild(retryGoogleRequest(request, { maxRetries: 1 }));
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(500));

        expect(yield* Fiber.join(result)).toBe("ok");
        expect(request).toHaveBeenCalledTimes(2);
      }),
    ));

  it("does not retry when maxRetries is unset", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const error = googleApiError(429);
        const request = vi.fn<() => Promise<string>>().mockRejectedValue(error);

        expect(yield* defectOf(retryGoogleRequest(request))).toBe(error);
        expect(request).toHaveBeenCalledTimes(1);
      }),
    ));

  it("does not retry a non-retryable status", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const error = googleApiError(400);
        const request = vi.fn<() => Promise<string>>().mockRejectedValue(error);

        expect(yield* defectOf(retryGoogleRequest(request, { maxRetries: 2 }))).toBe(error);
        expect(request).toHaveBeenCalledTimes(1);
      }),
    ));
});
