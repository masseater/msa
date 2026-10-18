import type { Api, Model, Provider } from "@msa/ai";
import { gate } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { defaultModelPerProvider } from "../../../src/core/model-resolver.ts";
import { ModelRuntime } from "../../../src/core/model-runtime.ts";
import { LoginFlow, type LoginFlowHost } from "../../../src/modes/interactive/login-flow.ts";
import { createHarness, type Harness } from "../harness.ts";

function complete(
  host: object,
  providerId: string,
  providerName: string,
  authType: "oauth" | "api_key",
  previousModel: Model<Api>,
): Promise<void> {
  return new LoginFlow(host as LoginFlowHost).completeProviderAuthentication(
    providerId,
    providerName,
    authType,
    previousModel,
  );
}

const dynamicModel: Model<"openai-completions"> = {
  id: "dynamic",
  name: "Dynamic",
  api: "openai-completions",
  provider: "stalled-login",
  baseUrl: "https://example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

let harness!: Harness;

const doesNotHoldLoginBehindAn = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const networkStarted = gate();
  const provider: Provider<"openai-completions"> = {
    id: "stalled-login",
    name: "Stalled Login",
    auth: {
      apiKey: {
        name: "API key",
        login: () => Promise.resolve({ type: "api_key", key: "secret" }),
        check: ({ credential }) =>
          Promise.resolve(
            credential?.key !== undefined && credential?.key !== ""
              ? { type: "api_key", source: "stored key" }
              : undefined,
          ),
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
    refreshModels: ({ allowNetwork }) =>
      runPromise(
        Effect.gen(function* () {
          if (!allowNetwork) return;
          networkStarted.release();
          yield* Effect.promise(() => new Promise<void>(() => {}));
        }),
      ),
    stream: () => {
      throw new Error("unused");
    },
    streamSimple: () => {
      throw new Error("unused");
    },
  };
  const credentials = AuthStorage.inMemory();
  const runtime = yield* Effect.promise(() =>
    ModelRuntime.create({
      credentials,
      modelsPath: null,
      allowModelNetwork: false,
    }),
  );
  runtime.registerNativeProvider(provider);
  yield* Effect.promise(() => runtime.refresh({ allowNetwork: false, providers: [provider.id] }));

  const stalledRefresh = runtime.refresh({ allowNetwork: true, providers: [provider.id] });
  yield* Effect.promise(() => networkStarted);
  yield* Effect.promise(() =>
    expect(
      runtime.login(provider.id, "api_key", {
        prompt: () => Promise.resolve("unused"),
        notify: () => {},
      }),
    ).resolves.toEqual({ type: "api_key", key: "secret" }),
  );

  expect(runtime.getAvailableSnapshot().map((model) => model.id)).toContain(dynamicModel.id);
  expect(yield* Effect.promise(() => credentials.read(provider.id))).toEqual({
    type: "api_key",
    key: "secret",
  });
  yield* Effect.promise(() => expect(stalledRefresh).resolves.toMatchObject({ aborted: false }));
});

const completesInteractiveLoginBeforeItsBounded = Effect.gen(function* () {
  harness = yield* Effect.promise(() => createHarness());
  vi.useFakeTimers();
  const runtime = harness.session.modelRuntime;
  vi.spyOn(runtime, "refresh").mockImplementation(
    (options) =>
      new Promise((resolve) => {
        options?.signal?.addEventListener(
          "abort",
          () => resolve({ aborted: true, errors: new Map() }),
          {
            once: true,
          },
        );
      }),
  );
  const showWarning = vi.fn();
  const context = {
    session: harness.session,
    refreshAuthState: vi.fn(),
    showStatus: vi.fn(),
    showError: vi.fn(),
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

describe("issues #7027 and #7113 credential refresh hang", () => {
  afterEach(() => {
    vi.useRealTimers();
    harness?.cleanup();
    vi.restoreAllMocks();
  });
  it("does not hold login behind an older stalled network catalog refresh", () =>
    Effect.runPromise(doesNotHoldLoginBehindAn));
  it("completes interactive login before its bounded background refresh", () =>
    Effect.runPromise(completesInteractiveLoginBeforeItsBounded));
});

let harness3!: Harness;

function startLogin() {
  return Effect.runPromise(
    Effect.gen(function* () {
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      harness3 = yield* Effect.promise(() => createHarness());
      vi.useFakeTimers();
      const session = harness3.session;
      const model = harness3.getModel();
      const unknownModel = { ...model, id: "unknown", provider: "unknown", api: "unknown" };
      const currentModel = vi.spyOn(session, "model", "get").mockReturnValue(unknownModel);
      const availableModels = vi
        .spyOn(session.modelRuntime, "getAvailableSnapshot")
        .mockReturnValue([]);
      let finishRefresh = () => {};
      vi.spyOn(session.modelRuntime, "refresh").mockImplementation(
        (options) =>
          new Promise((resolve) => {
            finishRefresh = () => resolve({ aborted: false, errors: new Map() });
            options?.signal?.addEventListener(
              "abort",
              () => resolve({ aborted: true, errors: new Map() }),
              {
                once: true,
              },
            );
          }),
      );
      const setModel = vi.spyOn(session, "setModel").mockResolvedValue();
      const context = {
        session,
        refreshAuthState: vi.fn(),
        showStatus: vi.fn(),
        showError: vi.fn(),
        showWarning: vi.fn(),
        ui: { requestRender: vi.fn() },
      };
      yield* Effect.promise(() =>
        complete(context, "openrouter", "OpenRouter", "oauth", unknownModel),
      );
      expect(context.showStatus).toHaveBeenCalledWith(expect.stringContaining("Credentials saved"));
      expect(context.showError).not.toHaveBeenCalled();
      expect(setModel).not.toHaveBeenCalled();

      return {
        ...context,
        setModel,
        currentModel,
        discover(ids: string[]) {
          return runPromise(
            Effect.gen(function* () {
              availableModels.mockReturnValue(
                ids.map((id) => ({ ...model, provider: "openrouter", id })),
              );
              finishRefresh();
              yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
            }),
          );
        },
      };
    }),
  );
}

const selectsTheDefaultModelFromThe = Effect.gen(function* () {
  const selected = defaultModelPerProvider.openrouter!;
  const login = yield* Effect.promise(() => startLogin());
  yield* Effect.promise(() => login.discover(["fast", selected]));
  expect(login.setModel).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "openrouter", id: selected }),
    {
      persist: true,
    },
  );
  expect(login.showError).not.toHaveBeenCalled();
});

const reportsARefreshedCatalogWithoutThe = Effect.gen(function* () {
  const login = yield* Effect.promise(() => startLogin());
  yield* Effect.promise(() => login.discover(["fast", "powerful"]));
  expect(login.setModel).not.toHaveBeenCalled();
  expect(login.showError).toHaveBeenCalledWith(expect.stringContaining("is not available"));
});

const reportsAnEmptyCatalogOnlyAfter = Effect.gen(function* () {
  const login = yield* Effect.promise(() => startLogin());
  yield* Effect.promise(() => login.discover([]));
  expect(login.setModel).not.toHaveBeenCalled();
  expect(login.showError).toHaveBeenCalledWith(expect.stringContaining("no models are available"));
});

const preservesAModelSelectedDuringRefresh = Effect.gen(function* () {
  const login = yield* Effect.promise(() => startLogin());
  login.currentModel.mockReturnValue(harness3!.getModel());
  yield* Effect.promise(() => login.discover(["fast", "balanced"]));
  expect(login.setModel).not.toHaveBeenCalled();
  expect(login.showError).not.toHaveBeenCalled();
});

const boundsRefreshTo15Seconds = Effect.gen(function* () {
  const login = yield* Effect.promise(() => startLogin());
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(15_000));
  expect(login.showWarning).toHaveBeenCalledWith(expect.stringContaining("timed out"));
  expect(login.showError).toHaveBeenCalledWith(expect.stringContaining("no models are available"));
  expect(login.setModel).not.toHaveBeenCalled();
});

describe("post-login model discovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    harness3?.cleanup();
    vi.restoreAllMocks();
  });
  it("selects the default model from the refreshed catalog", () =>
    Effect.runPromise(selectsTheDefaultModelFromThe));
  it("reports a refreshed catalog without the default model", () =>
    Effect.runPromise(reportsARefreshedCatalogWithoutThe));
  it("reports an empty catalog only after refresh", () =>
    Effect.runPromise(reportsAnEmptyCatalogOnlyAfter));
  it("preserves a model selected during refresh", () =>
    Effect.runPromise(preservesAModelSelectedDuringRefresh));
  it("bounds refresh to 15 seconds", () => Effect.runPromise(boundsRefreshTo15Seconds));
});
