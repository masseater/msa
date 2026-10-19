import type { Models } from "@msa/ai";
import { deferredPromise } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { Model } from "../../../../../libs/ai/src/model-types.ts";
import type { Api } from "../../../../../libs/ai/src/types.ts";
import { ModelRuntime } from "../../../src/core/model-runtime.ts";
import { createHarness, type Harness } from "../harness.ts";

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

interface StalledCredentialList {
  started: Promise<void>;
  release(): void;
  fail(error: Error): void;
  getCallCount(): number;
}

function createDeferred(): Deferred {
  const deferred = deferredPromise<void>();
  return {
    promise: deferred.promise,
    resolve: () => deferred.resolve(undefined),
    reject: (error) => deferred.reject(error),
  };
}

function stallNextCredentialList(harness: Harness): StalledCredentialList {
  const originalList = harness.authStorage.list.bind(harness.authStorage);
  const started = createDeferred();
  const gate = createDeferred();
  let shouldStall = true;
  let callCount = 0;

  harness.authStorage.list = () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const entries = yield* Effect.promise(() => originalList());
        callCount++;
        if (!shouldStall) return entries;
        shouldStall = false;
        started.resolve();
        yield* Effect.promise(() => gate.promise);
        return entries;
      }),
    );

  return {
    started: started.promise,
    release: gate.resolve,
    fail: gate.reject,
    getCallCount: () => callCount,
  };
}

function waitForRecoveryRefresh(
  stalledList: StalledCredentialList,
  harness: Harness,
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const refresh = harness.session.modelRuntime.refresh({ allowNetwork: false });
      yield* Effect.promise(() => vi.waitFor(() => expect(stalledList.getCallCount()).toBe(2)));
      yield* Effect.promise(() => refresh);
    }),
  );
}

let harness!: Harness;

let stalledList!: StalledCredentialList;

const recoversWithoutLettingTheStalledRefresh = Effect.gen(function* () {
  harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  const runtime = harness.session.modelRuntime;
  yield* Effect.promise(() =>
    harness.authStorage.modify("stale-provider", () =>
      Promise.resolve({
        type: "api_key",
        key: "stale-key",
      }),
    ),
  );
  yield* Effect.promise(() => runtime.refresh({ allowNetwork: false }));
  expect(runtime.getProviderAuthStatus("stale-provider")).toEqual({
    configured: true,
    source: "stored",
  });
  stalledList = stallNextCredentialList(harness);
  const staleRefresh = runtime.getAvailable();
  yield* Effect.promise(() => stalledList.started);
  yield* Effect.promise(() => harness.authStorage.delete("stale-provider"));
  yield* Effect.promise(() =>
    harness.authStorage.modify("current-provider", () =>
      Promise.resolve({
        type: "api_key",
        key: "current-key",
      }),
    ),
  );
  yield* Effect.promise(() => waitForRecoveryRefresh(stalledList, harness));
  return yield* recoversWithoutLettingTheStalledRefreshPart2(runtime, staleRefresh);
});

const recoversWithoutLettingTheStalledRefreshPart2 = (
  runtime: ModelRuntime,
  staleRefresh: Promise<readonly Model<Api>[]>,
) =>
  Effect.gen(function* () {
    expect(runtime.getProviderAuthStatus("stale-provider")).toEqual({ configured: false });
    expect(runtime.getProviderAuthStatus("current-provider")).toEqual({
      configured: true,
      source: "stored",
    });
    stalledList.release();
    yield* Effect.promise(() => staleRefresh);
    expect(runtime.getProviderAuthStatus("stale-provider")).toEqual({ configured: false });
    expect(runtime.getProviderAuthStatus("current-provider")).toEqual({
      configured: true,
      source: "stored",
    });
  });

const doesNotLetAStaleFailure = Effect.gen(function* () {
  harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  const runtime = harness.session.modelRuntime;
  stalledList = stallNextCredentialList(harness);
  const staleRefresh = runtime.getAvailable();
  yield* Effect.promise(() => stalledList.started);

  yield* Effect.promise(() => waitForRecoveryRefresh(stalledList, harness));
  expect(runtime.getError()).toBeUndefined();

  stalledList.fail(new Error("stale credential list failure"));
  yield* Effect.promise(() =>
    expect(staleRefresh).rejects.toThrow("stale credential list failure"),
  );
  expect(runtime.getError()).toBeUndefined();
});

const doesNotLetAStaleProvider = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  harness = yield* Effect.promise(() => createHarness());
  const runtime = harness.session.modelRuntime;
  const models = Reflect.get(runtime, "models") as Models;
  const originalGetAvailable = models.getAvailable.bind(models);
  const started = createDeferred();
  const gate = createDeferred();
  let stall = true;
  models.getAvailable = (providerId, options) =>
    runPromise(
      Effect.gen(function* () {
        if (providerId === undefined || providerId === "" || !stall)
          return yield* Effect.promise(() => originalGetAvailable(providerId, options));
        stall = false;
        started.resolve();
        yield* Effect.promise(() => gate.promise);
        throw new Error("stale provider availability failure");
      }),
    );

  const staleRefresh = runtime.getAvailable(harness.getModel().provider);
  yield* Effect.promise(() => started.promise);
  yield* Effect.promise(() => runtime.getAvailable());
  expect(runtime.getError()).toBeUndefined();

  gate.resolve();
  yield* Effect.promise(() =>
    expect(staleRefresh).rejects.toThrow("stale provider availability failure"),
  );
  expect(runtime.getError()).toBeUndefined();
});

describe("issue #7301 stalled availability refresh", () => {
  afterEach(() => {
    stalledList?.release();
    harness?.cleanup();
  });
  it("recovers without letting the stalled refresh overwrite the newer snapshot", () =>
    Effect.runPromise(recoversWithoutLettingTheStalledRefresh));
  it("does not let a stale failure overwrite newer availability error state", () =>
    Effect.runPromise(doesNotLetAStaleFailure));
  it("does not let a stale provider-scoped failure overwrite a newer availability pass", () =>
    Effect.runPromise(doesNotLetAStaleProvider));
});
