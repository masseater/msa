import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { lazyApi } from "../src/api/lazy.ts";
import { envApiKeyAuth } from "../src/auth/helpers.ts";
import type { AuthContext } from "../src/auth/types.ts";
import { createModels, createProvider } from "../src/models.ts";
import { anthropicProvider } from "../src/providers/anthropic.ts";
import type { DeferredHandle } from "../src/types.ts";
import providersSupport from "./providers-support.ts";

const { context, recordingStreams, testModel } = providersSupport;

function fakeAuthContext(env: Record<string, string>): AuthContext {
  return {
    env: (name) => Promise.resolve(env[name]),
    fileExists: () => Promise.resolve(false),
  };
}

const neverAbortedSignal = new AbortController().signal;

const resolvesAnthropicBearerAuthFromEnv = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const models = createModels({
        authContext: fakeAuthContext({
          ANTHROPIC_API_KEY: "api-key",
          ANTHROPIC_AUTH_TOKEN: "auth-token",
        }),
      });
      models.setProvider(anthropicProvider());

      expect(yield* Effect.promise(() => models.getAuth("anthropic-api"))).toEqual({
        auth: { headers: { Authorization: "Bearer auth-token" } },
        source: "ANTHROPIC_AUTH_TOKEN",
      });
    }),
  );

const prefersTheStoredCredentialKeyAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const auth = envApiKeyAuth("Test key", ["FIRST_KEY", "SECOND_KEY"]);

      const stored = yield* Effect.promise(() =>
        auth.resolve({
          credential: { key: "stored", type: "api_key" },
          ctx: fakeAuthContext({ FIRST_KEY: "env" }),
          signal: neverAbortedSignal,
        }),
      );
      expect(stored?.auth.apiKey).toBe("stored");
      expect(stored?.source).toBe("stored credential");

      const second = yield* Effect.promise(() =>
        auth.resolve({
          ctx: fakeAuthContext({ SECOND_KEY: "second" }),
          signal: neverAbortedSignal,
        }),
      );
      expect(second?.auth.apiKey).toBe("second");
      expect(second?.source).toBe("SECOND_KEY");

      expect(
        yield* Effect.promise(() =>
          auth.resolve({ ctx: fakeAuthContext({}), signal: neverAbortedSignal }),
        ),
      ).toBeUndefined();
    }),
  );

const loginPromptsForASecretAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const auth = envApiKeyAuth("Test key", ["TEST_KEY"]);
      const credential = yield* Effect.promise(() =>
        Promise.resolve(
          auth.login?.({
            notify: () => {},
            prompt: (prompt) => {
              expect(prompt.type).toBe("secret");
              return Promise.resolve("entered-key");
            },
            signal: neverAbortedSignal,
          }),
        ),
      );
      expect(credential).toEqual({ key: "entered-key", type: "api_key" });
    }),
  );

describe("builtin providers", () => {
  it(
    "resolves Anthropic bearer auth from env with auth token precedence",
    resolvesAnthropicBearerAuthFromEnv,
  );
});

describe("envApiKeyAuth", () => {
  it(
    "prefers the stored credential key and falls back through env vars in order",
    prefersTheStoredCredentialKeyAnd,
  );
});

describe("envApiKeyAuth", () => {
  it("login prompts for a secret and returns an api-key credential", loginPromptsForASecretAnd);
});

const lazilyExposesOnlyDeclaredDeferredCapabilities = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const loads = { value: 0 };
      const streams = recordingStreams("deferred", []);
      streams.fetchDeferred = (model) => streams.streamSimple(model, context);
      const api = lazyApi(
        () => {
          loads.value++;
          return Promise.resolve(streams);
        },
        { fetchDeferred: true },
      );
      const model = testModel("api-a", "model-a");
      const handle: DeferredHandle = {
        api: model.api,
        id: "response-1",
        modelId: model.id,
        provider: model.provider,
      };

      expect(loads.value).toBe(0);
      expect(api.cancelDeferred).toBeUndefined();
      expect(
        (yield* Effect.promise(() => api.fetchDeferred!(model, handle).result())).stopReason,
      ).toBe("stop");
      expect(loads.value).toBe(1);
    }),
  );

describe("createProvider", () => {
  it(
    "lazily exposes only declared deferred capabilities",
    lazilyExposesOnlyDeclaredDeferredCapabilities,
  );
});

const dispatchesOnModelApiForMixed = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const calls: string[] = [];
      const provider = createProvider({
        api: { "api-a": recordingStreams("a", calls), "api-b": recordingStreams("b", calls) },
        auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
        id: "mixed",
        models: [testModel("api-a", "model-a"), testModel("api-b", "model-b")],
      });
      const models = createModels();
      models.setProvider(provider);

      yield* Effect.promise(() => models.completeSimple(testModel("api-a", "model-a"), context));
      yield* Effect.promise(() => models.completeSimple(testModel("api-b", "model-b"), context));
      expect(calls).toEqual(["a:model-a", "b:model-b"]);
    }),
  );

describe("createProvider", () => {
  it("dispatches on model.api for mixed-API providers", dispatchesOnModelApiForMixed);
});
