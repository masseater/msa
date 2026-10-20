import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type modelTypesModule from "../../../../../libs/ai/src/model-types.ts";
import type typesModule from "../../../../../libs/ai/src/types.types.ts";
import { ModelRuntime } from "../../../src/core/model-runtime.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;

const { deferredPromise } = testing;

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
    reject: (error) => deferred.reject(error),
    resolve: () => deferred.resolve(undefined),
  };
}

function stallNextCredentialList(harness: harnessTypes.Harness): StalledCredentialList {
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
    fail: gate.reject,
    getCallCount: () => callCount,
    release: gate.resolve,
    started: started.promise,
  };
}

function waitForRecoveryRefresh(
  stalledList: StalledCredentialList,
  harness: harnessTypes.Harness,
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const refresh = harness.session.modelRuntime.refresh({ allowNetwork: false });
      yield* Effect.promise(() => vi.waitFor(() => expect(stalledList.getCallCount()).toBe(2)));
      yield* Effect.promise(() => refresh);
    }),
  );
}

let harness!: harnessTypes.Harness;

let stalledList!: StalledCredentialList;

const recoversWithoutLettingTheStalledRefresh = Effect.gen(function* () {
  harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  const runtime = harness.session.modelRuntime;
  yield* Effect.promise(() =>
    harness.authStorage.modify("stale-provider", () =>
      Promise.resolve({
        key: "stale-key",
        type: "api_key",
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
        key: "current-key",
        type: "api_key",
      }),
    ),
  );
  yield* Effect.promise(() => waitForRecoveryRefresh(stalledList, harness));
  return yield* recoversWithoutLettingTheStalledRefreshStep1(runtime, staleRefresh);
});

const recoversWithoutLettingTheStalledRefreshStep1 = (
  runtime: ModelRuntime,
  staleRefresh: Promise<readonly modelTypesModule.Model<typesModule.Api>[]>,
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
  const models = Reflect.get(runtime, "models") as aiTypes.Models;
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

const recoversWithoutLettingTheStalledRefreshOverwrite = () =>
  Effect.runPromise(recoversWithoutLettingTheStalledRefresh);

const doesNotLetAStaleFailureOverwrite = () => Effect.runPromise(doesNotLetAStaleFailure);

const doesNotLetAStaleProviderScoped = () => Effect.runPromise(doesNotLetAStaleProvider);

describe("issue #7301 stalled availability refresh", () => {
  afterEach(() => {
    stalledList?.release();
    harness?.cleanup();
  });
  it(
    "recovers without letting the stalled refresh overwrite the newer snapshot",
    recoversWithoutLettingTheStalledRefreshOverwrite,
  );
  it(
    "does not let a stale failure overwrite newer availability error state",
    doesNotLetAStaleFailureOverwrite,
  );
  it(
    "does not let a stale provider-scoped failure overwrite a newer availability pass",
    doesNotLetAStaleProviderScoped,
  );
});
