import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type clientTypes from "../src/extensions/llama/client.types.ts";
import HuggingFaceClient from "../src/extensions/llama/hugging-face-client.ts";
import huggingface from "../src/extensions/llama/huggingface.ts";
import LlamaClient from "../src/extensions/llama/llama-client.ts";
import providerModule from "../src/extensions/llama/provider.ts";
import llamaExtensionSupport from "./llama-extension-support.ts";

const { createLlamaProvider } = providerModule;
const { findHuggingFaceToken } = huggingface;
const { abortController, awaited, closeServers, runTest } = testing;
const { eventStream, later, refresh, serve } = llamaExtensionSupport;

afterEach(() => runTest(closeServers));

const hidesUnloadedPresetsWhenRouterAutoloadIs = () =>
  runTest(
    Effect.gen(function* () {
      const url = yield* serve(({ path }) => {
        if (path === "/models") {
          return { data: [{ id: "preset", source: "preset", status: { value: "unloaded" } }] };
        }
        return path === "/props" ? { models_autoload: false, role: "router" } : undefined;
      });
      const controller = createLlamaProvider();
      yield* refresh(controller, { url });
      expect(controller.provider.getModels()).toEqual([]);
    }),
  );

const emptyContext: aiTypes.AuthContext = {
  env: () => runTest(Effect.as(Effect.void, undefined)),
  fileExists: () => runTest(Effect.succeed(false)),
};

const staysDormantUntilConfiguredAndStoresUrl = () =>
  runTest(
    Effect.gen(function* () {
      const { provider } = createLlamaProvider();
      const auth = provider.auth.apiKey!;
      const signal = abortController().signal;
      expect(yield* awaited(auth.check?.({ ctx: emptyContext, signal }))).toBeUndefined();
      expect(yield* awaited(auth.resolve({ ctx: emptyContext, signal }))).toBeUndefined();

      const url = yield* serve(({ headers }) => {
        expect(headers.get("authorization")).toBe("Bearer secret");
        return { data: [] };
      });
      const answers = [url, "secret"];
      const credential = yield* awaited(
        auth.login!({
          notify: () => {},
          prompt: (_prompt: aiTypes.AuthPrompt) => runTest(Effect.succeed(answers.shift()!)),
          signal,
        }),
      );
      expect(credential).toEqual({
        env: { LLAMA_BASE_URL: url },
        key: "secret",
        type: "api_key" as const,
      });
      expect(yield* awaited(auth.resolve({ credential, ctx: emptyContext, signal }))).toEqual({
        auth: { apiKey: "secret", baseUrl: `${url}/v1` },
        env: { LLAMA_BASE_URL: url },
        source: "stored credential",
      });
    }),
  );

const ggufDetails = {
  gated: "manual",
  id: "owner/model-GGUF",
  siblings: [
    { rfilename: "model-Q5_K_M.gguf", size: 6000 },
    { rfilename: "model-Q4_K_M-00001-of-00002.gguf", size: 2000 },
    { rfilename: "model-Q4_K_M-00002-of-00002.gguf", size: 3000 },
    { rfilename: "mmproj-F16.gguf", size: 1000 },
  ],
};

const huggingFaceServer = () =>
  serve(({ headers, path, url }) => {
    expect(headers.get("authorization")).toBe("Bearer hf-secret");
    if (url.pathname === "/api/models") {
      expect(url.searchParams.get("search")).toBe("qwen coder");
      expect(url.searchParams.get("filter")).toBe("gguf");
      expect(url.searchParams.get("sort")).toBe("downloads");
      return [{ downloads: 1200, id: "owner/model-GGUF" }];
    }
    return path === "/api/models/owner/model-GGUF?blobs=true" ? ggufDetails : undefined;
  });

const searchesHuggingFaceAndReadsQuantizationsPlus = () =>
  runTest(
    Effect.gen(function* () {
      const client = new HuggingFaceClient("hf-secret", yield* huggingFaceServer());
      expect(yield* awaited(client.search("qwen coder"))).toEqual([
        { downloads: 1200, id: "owner/model-GGUF" },
      ]);
      expect(yield* awaited(client.details("owner/model-GGUF"))).toEqual({
        gated: "manual",
        id: "owner/model-GGUF",
        quantizations: [
          { name: "Q4_K_M", size: 5000 },
          { name: "Q5_K_M", size: 6000 },
        ],
      });
      expect(yield* awaited(findHuggingFaceToken({ HF_TOKEN: " hf-secret " }))).toBe("hf-secret");
    }),
  );

const loadingProgress = {
  data: {
    progress: { current: "text_model", stages: ["text_model", "mmproj_model"], value: 0.5 },
    status: "loading",
  },
  event: "status_change",
  model: "test-model",
};

const loadingServer = () => {
  let status: "unloaded" | "loading" | "loaded" = "unloaded";
  const events = eventStream();
  return serve(({ method, path }) => {
    if (path === "/models/sse") return events.response();
    if (path === "/models") return { data: [{ id: "test-model", status: { value: status } }] };
    if (path !== "/models/load" || method !== "POST") return undefined;
    status = "loading";
    later(
      20,
      Effect.gen(function* () {
        yield* events.send(loadingProgress);
        status = "loaded";
        yield* events.send({
          data: { status: "loaded" },
          event: "status_change",
          model: "test-model",
        });
      }),
    );
    return { success: true };
  });
};

const loadsWithSseProgressAndWaitsFor = () =>
  runTest(
    Effect.gen(function* () {
      const url = yield* loadingServer();
      const progress: string[] = [];
      const model = yield* awaited(
        new LlamaClient(url).loadAndWait("test-model", (entry) => progress.push(entry.message)),
      );
      expect(model.status.value).toBe("loaded");
      expect(progress).toContain("Loading text model");
    }),
  );

const downloadServer = () => {
  let status: "missing" | "downloading" | "unloaded" = "missing";
  const events = eventStream();
  return serve(({ method, path }) => {
    if (path === "/models/sse") return events.response();
    if (path === "/models" && method === "POST") {
      status = "downloading";
      later(
        20,
        Effect.gen(function* () {
          yield* events.send({
            data: { progress: { "https://example/model.gguf": { done: 512, total: 1024 } } },
            event: "download_progress",
            model: "owner/repo:Q4_K_M",
          });
          status = "unloaded";
          yield* events.send({ data: {}, event: "download_finished", model: "owner/repo:Q4_K_M" });
        }),
      );
      return { success: true };
    }
    if (!path.startsWith("/models")) return undefined;
    return {
      data: status === "missing" ? [] : [{ id: "owner/repo:Q4_K_M", status: { value: status } }],
    };
  });
};

const downloadsWithByteProgressAndReturnsThe = () =>
  runTest(
    Effect.gen(function* () {
      const url = yield* downloadServer();
      const progress: clientTypes.LlamaProgress[] = [];
      const models = yield* awaited(
        new LlamaClient(url).downloadAndWait("owner/repo:Q4_K_M", (entry) => progress.push(entry)),
      );
      expect(models).toEqual([{ id: "owner/repo:Q4_K_M", status: { value: "unloaded" } }]);
      expect(progress).toContainEqual({
        detail: "512 B / 1.00 KiB",
        message: "Downloading model",
        ratio: 0.5,
      });
    }),
  );

describe("llama.cpp extension", () => {
  it(
    "hides unloaded presets when router autoload is disabled",
    hidesUnloadedPresetsWhenRouterAutoloadIs,
  );

  it(
    "stays dormant until configured and stores URL plus optional key",
    staysDormantUntilConfiguredAndStoresUrl,
  );

  it(
    "searches Hugging Face and reads quantizations plus access requirements",
    searchesHuggingFaceAndReadsQuantizationsPlus,
  );

  it(
    "loads with SSE progress and waits for the loaded catalog state",
    loadsWithSseProgressAndWaitsFor,
  );

  it(
    "downloads with byte progress and returns the refreshed catalog",
    downloadsWithByteProgressAndReturnsThe,
  );
});
