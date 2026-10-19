import { Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { lazyApi } from "../src/api/lazy.ts";
import { envApiKeyAuth } from "../src/auth/helpers.ts";
import type { AuthContext } from "../src/auth/types.ts";
import { getModel as getCompatModel, getModels as getCompatModels } from "../src/compat.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import { createModels, createProvider, getSupportedThinkingLevels } from "../src/models.ts";
import {
  builtinModels,
  builtinProviders,
  getAllBuiltinModels,
  getBuiltinClassifierModel,
  getBuiltinClassifierModels,
  getBuiltinImageModel,
  getBuiltinImageModels,
  getBuiltinModel,
  getBuiltinModels,
  getBuiltinProviders,
} from "../src/providers/all.ts";
import { anthropicProvider } from "../src/providers/anthropic.ts";
import { fauxAssistantMessage, fauxProvider } from "../src/providers/faux.ts";
import type {
  Api,
  DeferredCancelOptions,
  DeferredFetchOptions,
  DeferredHandle,
  Model,
  ProviderStreams,
} from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

function fakeAuthContext(env: Record<string, string>): AuthContext {
  return {
    env: (name) => Promise.resolve(env[name]),
    fileExists: () => Promise.resolve(false),
  };
}

const neverAbortedSignal = new AbortController().signal;

const context = normalizeContext({
  messages: [{ role: "user", content: "hi", timestamp: currentTimeMillis() }],
});

const DEFAULT_IMAGE_RESIZE = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBytes: 4.5 * 1024 * 1024,
  jpegQuality: 80,
};

describe("builtin providers", () => {
  it("builtinModels registers every builtin provider with models", () => {
    const models = builtinModels();
    const providers = models.getProviders();
    expect(providers.length).toBe(builtinProviders().length);
    expect(providers.map((p) => p.id)).toContain("anthropic-api");

    const anthropic = models.getModel("anthropic-api", "claude-haiku-4-5");
    expect(anthropic?.api).toBe("anthropic-messages");

    const all = models.getModels();
    expect(all.length).toBeGreaterThan(500);

    for (const provider of providers) {
      const list = models.getAllModels(provider.id);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((m) => m.provider === provider.id)).toBe(true);
    }

    return Promise.resolve();
  });

  it("returns empty results for unknown provider ids", () => {
    const unknownProvider = "not-a-provider" as never;
    const unknownModel = "x" as never;

    expect(getBuiltinModel(unknownProvider, unknownModel)).toBeUndefined();
    expect(getBuiltinImageModel(unknownProvider, unknownModel)).toBeUndefined();
    expect(getBuiltinClassifierModel(unknownProvider, unknownModel)).toBeUndefined();
    expect(getBuiltinModels(unknownProvider)).toEqual([]);
    expect(getBuiltinImageModels(unknownProvider)).toEqual([]);
    expect(getBuiltinClassifierModels(unknownProvider)).toEqual([]);
    expect(getAllBuiltinModels(unknownProvider)).toEqual([]);
    expect(getCompatModel(unknownProvider, unknownModel)).toBeUndefined();
    expect(getCompatModels(unknownProvider)).toEqual([]);
  });
});

describe("builtin providers", () => {
  it("stores native constrained-sampling capabilities in model metadata", () => {
    const gpt4o = getBuiltinModel("openai", "gpt-4o");
    expect(gpt4o.compat?.supportsStrictMode).toBe(true);
    expect(gpt4o.compat?.supportsOpenAIGrammarTools).toBeUndefined();
    expect(getBuiltinModel("openai", "gpt-5.4").compat).toMatchObject({
      supportsStrictMode: true,
      supportsOpenAIGrammarTools: true,
    });
    expect(getBuiltinModel("anthropic-api", "claude-haiku-4-5").compat?.supportsStrictTools).toBe(
      true,
    );
  });
});

describe("builtin providers", () => {
  it("keeps the conservative resize profile on every vision model", () => {
    const visionModels = getBuiltinProviders()
      .flatMap((provider) => getBuiltinModels(provider))
      .filter((model) => model.input.includes("image"));
    expect(visionModels.length).toBeGreaterThan(0);
    for (const model of visionModels) {
      expect(model.inputLimits?.images?.resize).toEqual(DEFAULT_IMAGE_RESIZE);
    }
  });

  it("records known direct-provider image request limits", () => {
    expect(getBuiltinModel("anthropic-api", "claude-haiku-4-5").inputLimits).toMatchObject({
      maxRequestBytes: 32 * 1024 * 1024,
      images: { maxPerRequest: 100 },
    });
    expect(
      getBuiltinModel("anthropic-api", "claude-opus-5").inputLimits?.images?.maxPerRequest,
    ).toBe(600);
    expect(getBuiltinModel("openai", "gpt-4o").inputLimits).toMatchObject({
      maxRequestBytes: 512 * 1024 * 1024,
      images: { maxPerRequest: 1500 },
    });
  });

  it("does not infer image limits from gateway API compatibility", () => {
    const openRouterModel = getBuiltinModels("openrouter").find((model) =>
      model.input.includes("image"),
    );
    expect(openRouterModel?.inputLimits).toEqual({ images: { resize: DEFAULT_IMAGE_RESIZE } });
  });
});

describe("builtin providers", () => {
  it("uses models.dev effort levels for Google thinking models", () => {
    expect(getSupportedThinkingLevels(getBuiltinModel("opencode", "gemini-3.8-flash"))).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("builtin providers", () => {
  it("enables mid-conversation system messages only for verified models", () => {
    const models = builtinModels();
    const supported = [
      ["openai", "gpt-5.4"],
      ["openai", "gpt-5.5"],
      ["openai", "gpt-6-astra"],
      ["openai-codex", "gpt-5.5"],
      ["anthropic-api", "claude-opus-5"],
      ["opencode", "gpt-5.4"],
      ["opencode", "gpt-5.6-terra"],
      ["opencode-go", "gpt-5.6-luna"],
      ["opencode", "claude-opus-4-8"],
      ["opencode", "claude-opus-5"],
      ["opencode", "kimi-k3"],
      ["opencode-go", "kimi-k3"],
      ["openrouter", "openai/gpt-5.6-terra"],
    ] as const;
    const unsupported = [
      ["openai", "gpt-4.1"],
      ["openai", "gpt-5.2"],
      ["anthropic-api", "claude-sonnet-4-5"],
      ["opencode", "gemini-3.1-pro"],
      ["opencode", "gpt-5.2"],
      ["opencode", "claude-sonnet-4-5"],
      ["openrouter", "anthropic/claude-opus-5"],
      ["openrouter", "moonshotai/kimi-k3"],
      ["openrouter", "openai/gpt-5.6-terra:batch"],
    ] as const;
    for (const [provider, modelId] of supported) {
      expect(models.getModel(provider, modelId), `${provider}/${modelId}`).toHaveProperty(
        "compat.supportsMidConvoSystemMessages",
        true,
      );
    }
    for (const [provider, modelId] of unsupported) {
      expect(models.getModel(provider, modelId), `${provider}/${modelId}`).not.toHaveProperty(
        "compat.supportsMidConvoSystemMessages",
      );
    }
  });
});

describe("builtin providers", () => {
  it("routes proxied tool changes through verified transports only", () => {
    const models = builtinModels();
    expect(models.getModel("opencode", "gpt-5.6-terra")?.compat).toMatchObject({
      supportsAdditionalTools: true,
    });
    expect(models.getModel("opencode", "gpt-5.6-terra")?.compat).not.toHaveProperty(
      "supportsToolSearch",
    );
    expect(models.getModel("opencode", "claude-opus-5")?.compat).not.toHaveProperty(
      "supportsMidConvoToolChanges",
    );
    expect(models.getModel("anthropic-api", "claude-opus-5")?.compat).toMatchObject({
      supportsMidConvoToolChanges: true,
    });
    for (const provider of ["opencode", "opencode-go"] as const) {
      expect(models.getModel(provider, "kimi-k3")?.compat, provider).toMatchObject({
        supportsMidConvoToolAdditions: true,
      });
    }
    expect(models.getModel("openrouter", "moonshotai/kimi-k3")?.compat).not.toHaveProperty(
      "supportsMidConvoToolAdditions",
    );
    expect(models.getModel("openrouter", "openai/gpt-5.6-terra")?.compat).not.toHaveProperty(
      "supportsMidConvoToolAdditions",
    );
  });
});

describe("builtin providers", () => {
  it("resolves Anthropic bearer auth from env with auth token precedence", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const models = createModels({
          authContext: fakeAuthContext({
            ANTHROPIC_AUTH_TOKEN: "auth-token",
            ANTHROPIC_API_KEY: "api-key",
          }),
        });
        models.setProvider(anthropicProvider());

        expect(yield* Effect.promise(() => models.getAuth("anthropic-api"))).toEqual({
          auth: { headers: { Authorization: "Bearer auth-token" } },
          source: "ANTHROPIC_AUTH_TOKEN",
        });
      }),
    ));
});

describe("envApiKeyAuth", () => {
  it("prefers the stored credential key and falls back through env vars in order", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const auth = envApiKeyAuth("Test key", ["FIRST_KEY", "SECOND_KEY"]);

        const stored = yield* Effect.promise(() =>
          auth.resolve({
            ctx: fakeAuthContext({ FIRST_KEY: "env" }),
            credential: { type: "api_key", key: "stored" },
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
    ));
});

describe("envApiKeyAuth", () => {
  it("login prompts for a secret and returns an api-key credential", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const auth = envApiKeyAuth("Test key", ["TEST_KEY"]);
        const credential = yield* Effect.promise(() =>
          Promise.resolve(
            auth.login?.({
              signal: neverAbortedSignal,
              prompt: (prompt) => {
                expect(prompt.type).toBe("secret");
                return Promise.resolve("entered-key");
              },
              notify: () => {},
            }),
          ),
        );
        expect(credential).toEqual({ type: "api_key", key: "entered-key" });
      }),
    ));
});

describe("createProvider", () => {
  function recordingStreams(label: string, calls: string[]): ProviderStreams {
    const respond = (model: Model<Api>) => {
      calls.push(`${label}:${model.id}`);
      const stream = new AssistantMessageEventStream();
      const message = fauxAssistantMessage("ok");
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    };
    return { stream: respond, streamSimple: respond };
  }
  function testModel(api: string, id: string): Model<Api> {
    return {
      id,
      name: id,
      api,
      provider: "mixed",
      baseUrl: "https://example.test/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 10000,
      maxTokens: 1000,
    };
  }
  it("lazily exposes only declared deferred capabilities", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let loads = 0;
        const streams = recordingStreams("deferred", []);
        streams.fetchDeferred = (model) => streams.streamSimple(model, context);
        const api = lazyApi(
          () => {
            loads++;
            return Promise.resolve(streams);
          },
          { fetchDeferred: true },
        );
        const model = testModel("api-a", "model-a");
        const handle: DeferredHandle = {
          provider: model.provider,
          modelId: model.id,
          api: model.api,
          id: "response-1",
        };

        expect(loads).toBe(0);
        expect(api.cancelDeferred).toBeUndefined();
        expect(
          (yield* Effect.promise(() => api.fetchDeferred!(model, handle).result())).stopReason,
        ).toBe("stop");
        expect(loads).toBe(1);
      }),
    ));
});

describe("createProvider", () => {
  function recordingStreams(label: string, calls: string[]): ProviderStreams {
    const respond = (model: Model<Api>) => {
      calls.push(`${label}:${model.id}`);
      const stream = new AssistantMessageEventStream();
      const message = fauxAssistantMessage("ok");
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    };
    return { stream: respond, streamSimple: respond };
  }
  function testModel(api: string, id: string): Model<Api> {
    return {
      id,
      name: id,
      api,
      provider: "mixed",
      baseUrl: "https://example.test/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 10000,
      maxTokens: 1000,
    };
  }
  it("dispatches on model.api for mixed-API providers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls: string[] = [];
        const provider = createProvider({
          id: "mixed",
          auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
          models: [testModel("api-a", "model-a"), testModel("api-b", "model-b")],
          api: { "api-a": recordingStreams("a", calls), "api-b": recordingStreams("b", calls) },
        });
        const models = createModels();
        models.setProvider(provider);

        yield* Effect.promise(() => models.completeSimple(testModel("api-a", "model-a"), context));
        yield* Effect.promise(() => models.completeSimple(testModel("api-b", "model-b"), context));
        expect(calls).toEqual(["a:model-a", "b:model-b"]);
      }),
    ));
});

describe("createProvider", () => {
  function recordingStreams(label: string, calls: string[]): ProviderStreams {
    const respond = (model: Model<Api>) => {
      calls.push(`${label}:${model.id}`);
      const stream = new AssistantMessageEventStream();
      const message = fauxAssistantMessage("ok");
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    };
    return { stream: respond, streamSimple: respond };
  }
  function testModel(api: string, id: string): Model<Api> {
    return {
      id,
      name: id,
      api,
      provider: "mixed",
      baseUrl: "https://example.test/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 10000,
      maxTokens: 1000,
    };
  }
  it("merges provider-resolved env into stream options", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let capturedEnv: Record<string, string> | undefined;
        let capturedApiKey: string | undefined;
        const envModel = { ...testModel("api-a", "model-a"), provider: "env-provider" };
        const provider = createProvider({
          id: "env-provider",
          auth: {
            apiKey: {
              name: "Test",
              resolve: () =>
                Promise.resolve({
                  auth: { apiKey: "provider-key" },
                  env: { PROVIDER_ONLY: "provider", SHARED: "provider" },
                }),
            },
          },
          models: [envModel],
          api: {
            stream: (model, _context, options) => {
              capturedEnv = options?.env;
              capturedApiKey = options?.apiKey;
              return recordingStreams("a", []).stream(model, _context, options);
            },
            streamSimple: (model, _context, options) => {
              capturedEnv = options?.env;
              capturedApiKey = options?.apiKey;
              return recordingStreams("a", []).streamSimple(model, _context, options);
            },
          },
        });
        const models = createModels();
        models.setProvider(provider);

        yield* Effect.promise(() =>
          models.completeSimple(envModel, context, {
            apiKey: "request-key",
            env: { REQUEST_ONLY: "request", SHARED: "request" },
          }),
        );

        expect(capturedApiKey).toBe("request-key");
        expect(capturedEnv).toEqual({
          PROVIDER_ONLY: "provider",
          REQUEST_ONLY: "request",
          SHARED: "request",
        });
      }),
    ));
});

describe("createProvider", () => {
  function recordingStreams(label: string, calls: string[]): ProviderStreams {
    const respond = (model: Model<Api>) => {
      calls.push(`${label}:${model.id}`);
      const stream = new AssistantMessageEventStream();
      const message = fauxAssistantMessage("ok");
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    };
    return { stream: respond, streamSimple: respond };
  }
  function testModel(api: string, id: string): Model<Api> {
    return {
      id,
      name: id,
      api,
      provider: "mixed",
      baseUrl: "https://example.test/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 10000,
      maxTokens: 1000,
    };
  }
  it("applies resolved request options to deferred fetch and cancellation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let fetchedModel: Model<Api> | undefined;
        let fetchedOptions: DeferredFetchOptions | undefined;
        let cancelledOptions: DeferredCancelOptions | undefined;
        const deferredModel = { ...testModel("api-a", "model-a"), provider: "deferred-provider" };
        const streams = recordingStreams("deferred", []);
        streams.fetchDeferred = (model, _handle, options) => {
          fetchedModel = model;
          fetchedOptions = options;
          return streams.streamSimple(model, context);
        };
        streams.cancelDeferred = (_model, _handle, options) => {
          cancelledOptions = options;

          return Promise.resolve();
        };
        const provider = createProvider({
          id: "deferred-provider",
          auth: {
            apiKey: {
              name: "Test",
              resolve: () =>
                Promise.resolve({
                  auth: {
                    apiKey: "provider-key",
                    baseUrl: "https://resolved.test/v1",
                    headers: { Authorization: "Bearer provider", "X-Shared": "provider" },
                  },
                  env: { PROVIDER_ONLY: "provider", SHARED: "provider" },
                }),
            },
          },
          models: [deferredModel],
          api: streams,
        });
        const models = createModels();
        models.setProvider(provider);
        const handle: DeferredHandle = {
          provider: deferredModel.provider,
          modelId: deferredModel.id,
          api: deferredModel.api,
          id: "response-1",
        };

        yield* Effect.promise(() =>
          models.fetchDeferred(deferredModel, handle, {
            wait: 50,
            timeoutMs: 100,
            apiKey: "request-key",
            headers: { "X-Request": "request", "x-shared": "request" },
            env: { REQUEST_ONLY: "request", SHARED: "request" },
            transformHeaders: (headers) => ({ ...headers, "X-Transformed": "yes" }),
          }),
        );
        yield* Effect.promise(() =>
          models.cancelDeferred(deferredModel, handle, {
            timeoutMs: 200,
            transformHeaders: (headers) => ({ ...headers, "X-Cancel": "yes" }),
          }),
        );

        expect(fetchedModel?.baseUrl).toBe("https://resolved.test/v1");
        expect(fetchedOptions).toMatchObject({
          wait: 50,
          timeoutMs: 100,
          apiKey: "request-key",
          headers: {
            Authorization: "Bearer provider",
            "X-Request": "request",
            "x-shared": "request",
            "X-Transformed": "yes",
          },
          env: { PROVIDER_ONLY: "provider", REQUEST_ONLY: "request", SHARED: "request" },
        });
        expect(cancelledOptions).toMatchObject({
          timeoutMs: 200,
          apiKey: "provider-key",
          headers: { Authorization: "Bearer provider", "X-Shared": "provider", "X-Cancel": "yes" },
          env: { PROVIDER_ONLY: "provider", SHARED: "provider" },
        });
      }),
    ));
});

describe("createProvider", () => {
  function recordingStreams(label: string, calls: string[]): ProviderStreams {
    const respond = (model: Model<Api>) => {
      calls.push(`${label}:${model.id}`);
      const stream = new AssistantMessageEventStream();
      const message = fauxAssistantMessage("ok");
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    };
    return { stream: respond, streamSimple: respond };
  }
  function testModel(api: string, id: string): Model<Api> {
    return {
      id,
      name: id,
      api,
      provider: "mixed",
      baseUrl: "https://example.test/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 10000,
      maxTokens: 1000,
    };
  }
  it("produces a stream error for a model whose api has no implementation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = createProvider({
          id: "mixed",
          auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
          models: [testModel("api-a", "model-a")],
          api: { "api-a": recordingStreams("a", []) },
        });
        const result = yield* Effect.promise(() =>
          provider.streamSimple(testModel("api-ghost", "model-x"), context).result(),
        );
        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toContain("no API implementation");
      }),
    ));
});

describe("createProvider", () => {
  function recordingStreams(label: string, calls: string[]): ProviderStreams {
    const respond = (model: Model<Api>) => {
      calls.push(`${label}:${model.id}`);
      const stream = new AssistantMessageEventStream();
      const message = fauxAssistantMessage("ok");
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    };
    return { stream: respond, streamSimple: respond };
  }
  function testModel(api: string, id: string): Model<Api> {
    return {
      id,
      name: id,
      api,
      provider: "mixed",
      baseUrl: "https://example.test/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 10000,
      maxTokens: 1000,
    };
  }
  it("lets a newer dynamic refresh bypass and supersede older network work", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const effectContext = yield* Effect.context();
        let fetches = 0;
        let markFirstStarted: (() => void) | undefined;
        let finishFirst: (() => void) | undefined;
        const firstStarted = new Promise<void>((resolve) => {
          markFirstStarted = resolve;
        });
        const firstBlocked = new Promise<void>((resolve) => {
          finishFirst = resolve;
        });
        const provider = createProvider({
          id: "dynamic",
          auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
          models: [],
          fetchModels: () =>
            Effect.runPromiseWith(effectContext)(
              Effect.gen(function* () {
                fetches++;
                const current = fetches;
                if (current === 1) {
                  markFirstStarted?.();
                  yield* Effect.promise(() => firstBlocked);
                }
                return [testModel("api-a", `listed-${current}`)];
              }),
            ),
          api: recordingStreams("a", []),
        });

        const store = new InMemoryModelsStore();
        const models = createModels({ modelsStore: store });
        models.setProvider(provider);
        expect(provider.getModels()).toEqual([]);

        const first = models.refresh({ providers: ["dynamic"] });
        yield* Effect.promise(() => firstStarted);
        const second = models.refresh({ providers: ["dynamic"] });
        yield* Effect.promise(() => expect(second).resolves.toMatchObject({ aborted: false }));
        yield* Effect.promise(() => expect(first).resolves.toMatchObject({ aborted: false }));
        expect(fetches).toBe(2);
        expect(provider.getModels().map((model) => model.id)).toEqual(["listed-2"]);
        expect(
          (yield* Effect.promise(() => store.read("dynamic")))?.models.map((model) => model.id),
        ).toEqual(["listed-2"]);

        finishFirst?.();
        yield* Effect.promise(
          () =>
            new Promise((resolve) => {
              setTimeout(resolve, 0);
            }),
        );
        expect(provider.getModels().map((model) => model.id)).toEqual(["listed-2"]);
        expect(
          (yield* Effect.promise(() => store.read("dynamic")))?.models.map((model) => model.id),
        ).toEqual(["listed-2"]);
      }),
    ));
});

describe("fauxProvider", () => {
  it("streams queued responses through a Models collection", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const faux = fauxProvider();
        const models = createModels();
        models.setProvider(faux.provider);
        faux.setResponses([fauxAssistantMessage("hello from faux")]);

        const model = models.getModels(faux.provider.id)[0];

        if (model === undefined) throw new Error("Expected a model");
        const result = yield* Effect.promise(() => models.completeSimple(model, context));
        expect(result.stopReason).toBe("stop");
        expect(result.content).toEqual([{ type: "text", text: "hello from faux" }]);
        expect(faux.state.callCount).toBe(1);
      }),
    ));
});

describe("fauxProvider", () => {
  it("submits, polls, and redeems deferred responses", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const faux = fauxProvider({ deferred: { pendingFetches: 1, pollAfterMs: 25 } });
        const models = createModels();
        models.setProvider(faux.provider);
        faux.setResponses([fauxAssistantMessage("ready")]);
        const model = faux.getModel();

        const submission = models.streamSimple(model, context, { deferred: { window: "1h" } });
        const eventTypes: string[] = [];
        yield* Stream.fromAsyncIterable(submission, (error) => error).pipe(
          Stream.orDie,
          Stream.runForEach((event) =>
            Effect.sync(() => {
              eventTypes.push(event.type);
            }),
          ),
        );
        const deferred = yield* Effect.promise(() => submission.result());
        expect(eventTypes).toEqual(["start", "done"]);
        expect(deferred).toMatchObject({ stopReason: "deferred", content: [] });
        expect(deferred.deferred).toEqual({
          provider: model.provider,
          modelId: model.id,
          api: model.api,
          id: expect.any(String),
          pollAfterMs: 25,
        });
        const handle = deferred.deferred;
        if (handle === undefined)
          throw new Error("Faux response did not include a deferred handle");

        const pending = yield* Effect.promise(() => models.fetchDeferred(model, handle));
        expect(pending.stopReason).toBe("deferred");
        expect(pending.deferred).toEqual(handle);

        const ready = yield* Effect.promise(() => models.fetchDeferred(model, handle, { wait: 0 }));
        expect(ready.stopReason).toBe("stop");
        expect(ready.content).toEqual([{ type: "text", text: "ready" }]);
        expect(ready.usage.totalTokens).toBeGreaterThan(0);
        expect(faux.state).toMatchObject({ callCount: 1, deferredFetchCount: 2 });
      }),
    ));
});

describe("fauxProvider", () => {
  it("records cancellation and returns deferred fetch failures in-band", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const faux = fauxProvider();
        const models = createModels();
        models.setProvider(faux.provider);
        faux.setResponses([
          () => Promise.reject(new Error("deferred failed")),
          fauxAssistantMessage("cancelled"),
        ]);
        const model = faux.getModel();

        const failedSubmission = yield* Effect.promise(() =>
          models.completeSimple(model, context, { deferred: true }),
        );
        const failedDeferred = failedSubmission.deferred;
        if (failedDeferred === undefined)
          throw new Error("Faux response did not include a deferred handle");
        const failed = yield* Effect.promise(() => models.fetchDeferred(model, failedDeferred));
        expect(failed).toMatchObject({ stopReason: "error", errorMessage: "deferred failed" });

        const cancelledSubmission = yield* Effect.promise(() =>
          models.completeSimple(model, context, { deferred: true }),
        );
        const cancelledDeferred = cancelledSubmission.deferred;
        if (cancelledDeferred === undefined)
          throw new Error("Faux response did not include a deferred handle");
        yield* Effect.promise(() => models.cancelDeferred(model, cancelledDeferred));
        expect(faux.state.cancelledDeferred).toEqual([cancelledDeferred]);
        const cancelled = yield* Effect.promise(() =>
          models.fetchDeferred(model, cancelledDeferred),
        );
        expect(cancelled).toMatchObject({
          stopReason: "error",
          errorMessage: expect.stringContaining("was cancelled"),
        });
      }),
    ));
});
