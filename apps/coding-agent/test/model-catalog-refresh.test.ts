import type { ModelsRefreshOptions, ModelsRefreshResult } from "@msa/ai";
import { awaited, runTest, abortController } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { refreshModelCatalogs } from "../src/modes/interactive/model-catalog-refresh.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
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
        yield* awaited(expect(first).resolves.toEqual(successfulRefresh()));
        yield* awaited(expect(second).resolves.toEqual(successfulRefresh()));
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
        yield* awaited(expect(first).rejects.toMatchObject({ name: "AbortError" }));
        expect(refreshSignal?.aborted).toBe(false);

        deferred.resolve(successfulRefresh());
        yield* awaited(expect(second).resolves.toEqual(successfulRefresh()));
      }),
    ));

  it("aborts an abandoned refresh and allows a later refresh to start", () =>
    runTest(
      Effect.gen(function* () {
        const refreshSignals: AbortSignal[] = [];
        const runtime = {
          refresh: vi.fn((options?: ModelsRefreshOptions) => {
            if (options?.signal !== undefined) refreshSignals.push(options.signal);
            return new Promise<ModelsRefreshResult>(() => {});
          }),
        };
        const firstController = abortController();
        const first = refreshModelCatalogs(runtime, firstController.signal);

        firstController.abort();
        yield* awaited(expect(first).rejects.toMatchObject({ name: "AbortError" }));
        yield* awaited(vi.waitFor(() => expect(refreshSignals[0]?.aborted).toBe(true)));

        const secondController = abortController();
        const second = refreshModelCatalogs(runtime, secondController.signal);
        expect(runtime.refresh).toHaveBeenCalledTimes(2);
        secondController.abort();
        yield* awaited(expect(second).rejects.toMatchObject({ name: "AbortError" }));
      }),
    ));
});
