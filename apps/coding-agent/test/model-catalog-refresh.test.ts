import type { ModelsRefreshOptions, ModelsRefreshResult } from "@msa/ai";
import { abortController, awaited, failure, runTest } from "@msa/testing";
import { Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { refreshModelCatalogs } from "../src/modes/interactive/model-catalog-refresh.ts";

interface DeferredResult<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): DeferredResult<T> {
  const deferred = Deferred.makeUnsafe<T>();
  return {
    promise: runTest(Deferred.await(deferred)),
    resolve: (value: T) => {
      Effect.runSync(Deferred.succeed(deferred, value));
    },
  };
}

function successfulRefresh(): ModelsRefreshResult {
  return { aborted: false, errors: new Map() };
}

describe("interactive model catalog refresh", () => {
  it("shares one runtime refresh between concurrent callers", () =>
    runTest(
      Effect.gen(function* () {
        const deferred = createDeferred<ModelsRefreshResult>();
        const runtime = { refresh: vi.fn((_options?: ModelsRefreshOptions) => deferred.promise) };
        const firstController = abortController();
        const secondController = abortController();

        const first = refreshModelCatalogs(runtime, firstController.signal);
        const second = refreshModelCatalogs(runtime, secondController.signal);

        expect(runtime.refresh).toHaveBeenCalledOnce();
        deferred.resolve(successfulRefresh());
        expect(yield* awaited(first)).toEqual(successfulRefresh());
        expect(yield* awaited(second)).toEqual(successfulRefresh());
      }),
    ));

  it("keeps the shared refresh alive when one caller stops waiting", () =>
    runTest(
      Effect.gen(function* () {
        const deferred = createDeferred<ModelsRefreshResult>();
        let refreshSignal: AbortSignal | undefined;
        const runtime = {
          refresh: vi.fn((options?: ModelsRefreshOptions) => {
            refreshSignal = options?.signal;
            return deferred.promise;
          }),
        };
        const firstController = abortController();
        const secondController = abortController();
        const first = refreshModelCatalogs(runtime, firstController.signal);
        const second = refreshModelCatalogs(runtime, secondController.signal);

        firstController.abort();
        expect(yield* failure(awaited(first))).toMatchObject({ name: "AbortError" });
        expect(refreshSignal?.aborted).toBe(false);

        deferred.resolve(successfulRefresh());
        expect(yield* awaited(second)).toEqual(successfulRefresh());
      }),
    ));

  it("aborts an abandoned refresh and allows a later refresh to start", () =>
    runTest(
      Effect.gen(function* () {
        const refreshSignals: AbortSignal[] = [];
        const runtime = {
          refresh: vi.fn((options?: ModelsRefreshOptions) => {
            if (options?.signal !== undefined) refreshSignals.push(options.signal);
            return runTest(Effect.never);
          }),
        };
        const firstController = abortController();
        const first = refreshModelCatalogs(runtime, firstController.signal);

        firstController.abort();
        expect(yield* failure(awaited(first))).toMatchObject({ name: "AbortError" });
        yield* awaited(vi.waitFor(() => expect(refreshSignals[0]?.aborted).toBe(true)));

        const secondController = abortController();
        const second = refreshModelCatalogs(runtime, secondController.signal);
        expect(runtime.refresh).toHaveBeenCalledTimes(2);
        secondController.abort();
        expect(yield* failure(awaited(second))).toMatchObject({ name: "AbortError" });
      }),
    ));
});
