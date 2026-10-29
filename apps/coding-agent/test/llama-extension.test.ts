import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import eventBus from "../src/core/event-bus.ts";
import loader from "../src/core/extensions/loader.ts";
import client from "../src/extensions/llama/client.ts";
import llamaExtension from "../src/extensions/llama/index.ts";
import providerModule from "../src/extensions/llama/provider.ts";
import llamaExtensionSupport from "./llama-extension-support.ts";

const { createExtensionRuntime, loadExtensionFromFactory } = loader;
const { createEventBus } = eventBus;
const { LLAMA_PROVIDER_ID, createLlamaProvider } = providerModule;
const { normalizeLlamaServerUrl } = client;

const { awaited, closeServers, runTest } = testing;
const { createCache, refresh, serve } = llamaExtensionSupport;

afterEach(() => runTest(closeServers));

const registersANativeProviderAndLlamaCommand = () =>
  runTest(
    Effect.gen(function* () {
      const runtime = createExtensionRuntime(() => ({}));
      const extension = yield* awaited(
        loadExtensionFromFactory(
          llamaExtension,
          process.cwd(),
          createEventBus(),
          runtime,
          "builtin:llama.cpp",
        ),
      );
      expect(extension.commands.get("llama")?.description).toBe("Manage llama.cpp router models");
      expect(runtime.pendingNativeProviderRegistrations.map((entry) => entry.provider.id)).toEqual([
        LLAMA_PROVIDER_ID,
      ]);
    }),
  );

const normalizesManagementAndInferenceUrls = () => {
  expect(normalizeLlamaServerUrl("http://127.0.0.1:8080/v1/")).toBe("http://127.0.0.1:8080");
  expect(normalizeLlamaServerUrl("https://example.com/prefix/v1")).toBe(
    "https://example.com/prefix",
  );
  expect(() => normalizeLlamaServerUrl("file:///tmp/llama")).toThrow("http or https");
};

const exposesLoadedAndSleepingModelsWithRouter = () => {
  const controller = createLlamaProvider();
  controller.setCatalog(
    [
      {
        architecture: { input_modalities: ["text", "image"] },
        id: "loaded",
        meta: { n_ctx: 65536, n_ctx_train: 131072 },
        status: { args: ["llama-server", "--n-gpu-layers", "999"], value: "loaded" },
      },
      { id: "sleeping", status: { value: "sleeping" } },
      { id: "unloaded", status: { value: "unloaded" } },
      { id: "loading", status: { value: "loading" } },
    ],
    "http://localhost:8080",
  );
  expect(controller.provider.getModels()).toEqual([
    expect.objectContaining({
      baseUrl: "http://localhost:8080/v1",
      contextWindow: 65536,
      id: "loaded",
      input: ["text", "image"],
      maxTokens: 65536,
    }),
    expect.objectContaining({ baseUrl: "http://localhost:8080/v1", id: "sleeping" }),
  ]);
};

const discoversChatTemplateThinkingSupportForLoaded = () =>
  runTest(
    Effect.gen(function* () {
      let propsRequests = 0;
      const url = yield* serve(({ path, url: requestUrl }) => {
        if (path === "/models") {
          return { data: [{ id: "qwen", meta: { n_ctx: 32768 }, status: { value: "loaded" } }] };
        }
        if (requestUrl.pathname !== "/props") return undefined;
        propsRequests++;
        expect(requestUrl.searchParams.get("model")).toBe("qwen");
        expect(requestUrl.searchParams.get("autoload")).toBe("false");
        return { chat_template: "{% if enable_thinking %}think{% endif %}" };
      });
      const controller = createLlamaProvider();
      yield* refresh(controller, { url });
      expect(propsRequests).toBe(1);
      expect(controller.provider.getModels()).toEqual([
        expect.objectContaining({
          compat: expect.objectContaining({ thinkingFormat: "qwen-chat-template" }),
          id: "qwen",
          reasoning: true,
          thinkingLevelMap: {
            high: null,
            low: null,
            medium: "medium",
            minimal: null,
            off: "off",
            xhigh: null,
          },
        }),
      ]);
    }),
  );

const catalogServer = () =>
  serve(({ path }) => {
    if (path === "/models") {
      return {
        data: [
          { id: "loaded", meta: { n_ctx: 32768 }, status: { value: "loaded" } },
          { id: "sleeping", meta: { n_ctx: 32768 }, status: { value: "sleeping" } },
          { id: "unloaded", status: { value: "unloaded" } },
        ],
      };
    }
    return path === "/props?autoload=false&model=loaded" ? {} : undefined;
  });

const persistsAndRestoresSelectableModelsForCache = () =>
  runTest(
    Effect.gen(function* () {
      const url = yield* catalogServer();
      const cache = createCache();
      const first = createLlamaProvider();
      yield* refresh(first, { publish: cache.publish, stored: cache.entry(), url });
      expect(first.provider.getModels().map((model) => model.id)).toEqual(["loaded", "sleeping"]);
      expect(cache.entry()?.models.map((model) => [model.id, model.api])).toEqual([
        ["loaded", "openai-completions"],
        ["sleeping", "openai-completions"],
        ["loaded", "llama-cpp-classify"],
        ["sleeping", "llama-cpp-classify"],
      ]);

      const second = createLlamaProvider();
      yield* refresh(second, {
        allowNetwork: false,
        publish: cache.publish,
        stored: cache.entry(),
        url,
      });
      expect(second.provider.getModels()).toEqual([
        expect.objectContaining({ baseUrl: `${url}/v1`, contextWindow: 32768, id: "loaded" }),
        expect.objectContaining({ baseUrl: `${url}/v1`, contextWindow: 32768, id: "sleeping" }),
      ]);
      expect(
        second.provider.getAllModels?.().filter((model) => model.type === "classifier"),
      ).toEqual(
        ["loaded", "sleeping"].map((id) =>
          expect.objectContaining({
            api: "llama-cpp-classify",
            baseUrl: url,
            contextWindow: 32768,
            id,
          }),
        ),
      );
    }),
  );

const presetModel = (loaded: boolean, unloadedArgs: string[] | undefined) =>
  loaded
    ? {
        id: "qwen",
        meta: { n_ctx: 65536, n_ctx_train: 128000 },
        source: "preset",
        status: { value: "loaded" },
      }
    : {
        id: "qwen",
        meta: { n_ctx_train: 128000 },
        source: "preset",
        status: {
          value: "unloaded",
          ...(unloadedArgs === undefined ? {} : { args: unloadedArgs }),
        },
      };

const preservesCachedLlamaCppContextForUnloaded = () =>
  runTest(
    Effect.gen(function* () {
      let loaded = true;
      let unloadedArgs: string[] | undefined;
      const url = yield* serve(({ path }) => {
        if (path === "/models") return { data: [presetModel(loaded, unloadedArgs)] };
        if (path === "/props?autoload=false&model=qwen") return {};
        return path === "/props" ? { models_autoload: true, role: "router" } : undefined;
      });
      const cache = createCache();
      const storedContextWindows = () =>
        cache
          .entry()
          ?.models.map((model) => ("contextWindow" in model ? model.contextWindow : undefined));

      yield* refresh(createLlamaProvider(), { publish: cache.publish, stored: cache.entry(), url });
      expect(storedContextWindows()).toEqual([65536, 65536]);

      loaded = false;
      const second = createLlamaProvider();
      yield* refresh(second, { publish: cache.publish, stored: cache.entry(), url });
      expect(second.provider.getModels()).toEqual([
        expect.objectContaining({ contextWindow: 65536, id: "qwen" }),
      ]);
      expect(storedContextWindows()).toEqual([65536, 65536]);

      unloadedArgs = ["llama-server", "--ctx-size", "32768"];
      yield* refresh(second, { publish: cache.publish, stored: cache.entry(), url });
      expect(storedContextWindows()).toEqual([32768, 32768]);
    }),
  );

const presetCatalog = {
  data: [
    { id: "preset", meta: { n_ctx: 65536 }, source: "preset", status: { value: "unloaded" } },
    { id: "failed-preset", source: "preset", status: { failed: true, value: "unloaded" } },
    { id: "cache", source: "cache", status: { value: "unloaded" } },
    { id: "models-dir", source: "models_dir", status: { value: "unloaded" } },
  ],
};

const exposesUnloadedPresetsOnlyWhenRouterAutoload = () =>
  runTest(
    Effect.gen(function* () {
      let propsRequests = 0;
      const url = yield* serve(({ headers, path }) => {
        expect(headers.get("authorization")).toBe("Bearer local");
        if (path === "/models") return presetCatalog;
        if (path !== "/props") return undefined;
        propsRequests++;
        return { models_autoload: true, role: "router" };
      });
      const cache = createCache();
      const controller = createLlamaProvider();
      yield* refresh(controller, { publish: cache.publish, url });
      expect(propsRequests).toBe(1);
      expect(controller.provider.getModels().map((model) => model.id)).toEqual(["preset"]);
      expect(cache.entry()?.models.map((model) => [model.id, model.api])).toEqual([
        ["preset", "openai-completions"],
        ["preset", "llama-cpp-classify"],
      ]);
    }),
  );

describe("llama.cpp extension", () => {
  it("registers a native provider and /llama command", registersANativeProviderAndLlamaCommand);

  it("normalizes management and inference URLs", normalizesManagementAndInferenceUrls);

  it(
    "exposes loaded and sleeping models with router metadata",
    exposesLoadedAndSleepingModelsWithRouter,
  );

  it(
    "discovers chat-template thinking support for loaded models",
    discoversChatTemplateThinkingSupportForLoaded,
  );

  it(
    "persists and restores selectable models for cache-only startup refreshes",
    persistsAndRestoresSelectableModelsForCache,
  );

  it(
    "preserves cached llama.cpp context for unloaded autoload presets",
    preservesCachedLlamaCppContextForUnloaded,
  );

  it(
    "exposes unloaded presets only when router autoload is enabled",
    exposesUnloadedPresetsOnlyWhenRouterAutoload,
  );
});
