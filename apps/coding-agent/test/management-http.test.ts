import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { fetchWithRetry } from "../src/utils/management-http.ts";

const { abortController, awaited, runTest } = testing;

afterEach(() => vi.restoreAllMocks());

const retriesATransientTransportFailureOnce = () =>
  runTest(
    Effect.gen(function* () {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockResolvedValueOnce(Response.json({ ok: true }));

      const response = yield* awaited(fetchWithRetry("https://example.test"));
      expect(response.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    }),
  );

const sharesTheTimeoutBudgetAcrossAttempts = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const signals: AbortSignal[] = [];
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) =>
        effectRunPromise(
          Effect.gen(function* () {
            if (init?.signal !== undefined && init?.signal !== null) signals.push(init.signal);
            if (signals.length === 1) throw new Error("fetch failed");
            return yield* awaited(Response.json({ ok: true }));
          }),
        ),
      );

      const response = yield* awaited(
        fetchWithRetry("https://example.test", undefined, { timeoutMs: 1000 }),
      );
      expect(response.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(signals[0]).toBe(signals[1]);
    }),
  );

const retriesAnAttemptTimeout = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const controllers: AbortController[] = [];
      vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
        const controller = abortController();
        controllers.push(controller);
        return controller.signal;
      });
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) =>
        effectRunPromise(
          Effect.gen(function* () {
            if (fetchMock.mock.calls.length === 1) {
              const [controller] = controllers;
              if (controller === undefined) throw new Error("expected a timeout controller");
              controller.abort();
              init?.signal?.throwIfAborted();
            }
            return yield* awaited(Response.json({ ok: true }));
          }),
        ),
      );

      yield* awaited(fetchWithRetry("https://example.test", undefined, { attemptTimeoutMs: 4000 }));

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(controllers).toHaveLength(2);
    }),
  );

const retriesTransientHttpResponsesAndReturnsThe = () =>
  runTest(
    Effect.gen(function* () {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("busy", { status: 503 }))
        .mockResolvedValueOnce(Response.json({ ok: true }));

      const response = yield* awaited(fetchWithRetry("https://example.test"));
      expect(response.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }),
  );

const doesNotRetryCallerCancellation = () =>
  runTest(
    Effect.gen(function* () {
      const controller = abortController();
      controller.abort();
      const fetchMock = vi.spyOn(globalThis, "fetch");

      yield* awaited(
        expect(
          fetchWithRetry("https://example.test", { signal: controller.signal }),
        ).rejects.toThrow(),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );

describe("fetchWithRetry", () => {
  it("retries a transient transport failure once", retriesATransientTransportFailureOnce);

  it("shares the timeout budget across attempts", sharesTheTimeoutBudgetAcrossAttempts);

  it("retries an attempt timeout", retriesAnAttemptTimeout);

  it(
    "retries transient HTTP responses and returns the successful response",
    retriesTransientHttpResponsesAndReturnsThe,
  );

  it("does not retry caller cancellation", doesNotRetryCallerCancellation);
});
