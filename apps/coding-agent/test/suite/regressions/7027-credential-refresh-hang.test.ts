import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import AuthStorage from "../../../src/core/auth-storage.ts";
import ModelRuntime from "../../../src/core/model-runtime.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";
import CredentialRefreshHangSupport from "./7027-credential-refresh-hang-support.ts";
const { complete } = CredentialRefreshHangSupport;

const { createHarness } = harnessModule;

const { deferredPromise, gate } = testing;

const dynamicModel: aiTypes.Model<"openai-completions"> = {
  api: "openai-completions",
  baseUrl: "https://example.test/v1",
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "dynamic",
  input: ["text"],
  maxTokens: 100,
  name: "Dynamic",
  provider: "stalled-login",
  reasoning: false,
};

let harness!: harnessTypes.Harness;

const doesNotHoldLoginBehindAnSetup = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const networkStarted = gate();
    const provider: aiTypes.Provider<"openai-completions"> = {
      auth: {
        apiKey: {
          check: ({ credential }) =>
            Promise.resolve(
              credential?.key !== undefined && credential?.key !== ""
                ? { source: "stored key", type: "api_key" }
                : undefined,
            ),
          login: () => Promise.resolve({ key: "secret", type: "api_key" }),
          name: "API key",
          resolve: ({ credential }) =>
            Promise.resolve({
              auth: { apiKey: credential?.key ?? "ambient-key" },
              source:
                credential?.key !== undefined && credential?.key !== ""
                  ? "stored key"
                  : "ambient key",
            }),
        },
      },
      getModels: () => [dynamicModel],
      id: "stalled-login",
      name: "Stalled Login",
      refreshModels: ({ allowNetwork }) =>
        runPromise(
          Effect.gen(function* () {
            if (!allowNetwork) return;
            networkStarted.release();
            return yield* Effect.never;
          }),
        ),
      stream: () => {
        throw new Error("unused");
      },
      streamSimple: () => {
        throw new Error("unused");
      },
    };
    return { networkStarted, provider };
  });

const doesNotHoldLoginBehindAn = Effect.gen(function* () {
  const { networkStarted, provider } = yield* doesNotHoldLoginBehindAnSetup();
  const credentials = AuthStorage.inMemory();
  const runtime = yield* Effect.promise(() =>
    ModelRuntime.create({
      allowModelNetwork: false,
      credentials,
      modelsPath: null,
    }),
  );
  runtime.registerNativeProvider(provider);
  yield* Effect.promise(() => runtime.refresh({ allowNetwork: false, providers: [provider.id] }));

  const stalledRefresh = runtime.refresh({ allowNetwork: true, providers: [provider.id] });
  yield* Effect.promise(() => networkStarted);
  yield* Effect.promise(() =>
    expect(
      runtime.login(provider.id, "api_key", {
        notify: () => {},
        prompt: () => Promise.resolve("unused"),
      }),
    ).resolves.toEqual({ key: "secret", type: "api_key" }),
  );

  expect(runtime.getAvailableSnapshot().map((model) => model.id)).toContain(dynamicModel.id);
  expect(yield* Effect.promise(() => credentials.read(provider.id))).toEqual({
    key: "secret",
    type: "api_key",
  });
  yield* Effect.promise(() => expect(stalledRefresh).resolves.toMatchObject({ aborted: false }));
});

const completesInteractiveLoginBeforeItsBounded = Effect.gen(function* () {
  harness = yield* Effect.promise(() => createHarness());
  vi.useFakeTimers();
  const runtime = harness.session.models.selection.modelRuntime;
  vi.spyOn(runtime, "refresh").mockImplementation((options) => {
    const refresh = deferredPromise<{ aborted: boolean; errors: Map<string, string> }>();
    options?.signal?.addEventListener(
      "abort",
      () => refresh.resolve({ aborted: true, errors: new Map() }),
      { once: true },
    );
    return refresh.promise as unknown as ReturnType<typeof runtime.refresh>;
  });
  const showWarning = vi.fn();
  const context = {
    refreshAuthState: vi.fn(),
    session: harness.session,
    showError: vi.fn(),
    showStatus: vi.fn(),
    showWarning,
    ui: { requestRender: vi.fn() },
  };
  yield* Effect.promise(() =>
    complete(context, dynamicModel.provider, "Stalled Login", "api_key", harness.getModel()),
  );
  expect(runtime.refresh).toHaveBeenCalledWith({
    providers: [dynamicModel.provider],
    signal: expect.any(AbortSignal),
  });
  expect(showWarning).not.toHaveBeenCalled();

  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(15_000));
  expect(showWarning).toHaveBeenCalledWith(
    "Saved API key for Stalled Login, but its model catalog refresh timed out; using cached models.",
  );
});

const doesNotHoldLoginBehindAnOlder = () => Effect.runPromise(doesNotHoldLoginBehindAn);

const completesInteractiveLoginBeforeItsBoundedBackground = () =>
  Effect.runPromise(completesInteractiveLoginBeforeItsBounded);

const afterEachHook = () => {
  vi.useRealTimers();
  return Promise.resolve(harness?.cleanup()).finally(() => vi.restoreAllMocks());
};

describe("issues #7027 and #7113 credential refresh hang", () => {
  afterEach(afterEachHook);
  it(
    "does not hold login behind an older stalled network catalog refresh",
    doesNotHoldLoginBehindAnOlder,
  );
  it(
    "completes interactive login before its bounded background refresh",
    completesInteractiveLoginBeforeItsBoundedBackground,
  );
});
