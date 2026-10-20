import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createLlamaProvider } from "../src/extensions/llama/provider.ts";
import llamaExtensionSupport from "./llama-extension-support.ts";

const { awaited, closeServers, runTest } = testing;
const { createCache, refresh, serve } = llamaExtensionSupport;

afterEach(() => runTest(closeServers));

const completionReply = {
  completion_probabilities: [
    {
      top_logprobs: [
        { id: 66, logprob: -0.1, token: "B" },
        { id: 65, logprob: -2.4, token: "A" },
      ],
    },
  ],
};

const classifierServer = (paths: string[]) =>
  serve(({ json: payload, path }) => {
    paths.push(path);
    expect(payload["model"]).toBe("qwen");
    if (path === "/tokenize") {
      const content = typeof payload["content"] === "string" ? payload["content"] : "";
      return { tokens: [...content].map((char) => char.codePointAt(0)) };
    }
    if (path === "/apply-template") return { prompt: "<|im_start|>assistant\n" };
    return path === "/completion" ? completionReply : undefined;
  });

const classifiesWithSelectableModelsThroughLlamaServer = () =>
  runTest(
    Effect.gen(function* () {
      const paths: string[] = [];
      const url = yield* classifierServer(paths);
      const controller = createLlamaProvider();
      controller.setCatalog([{ id: "qwen", status: { value: "loaded" } }], url);
      const classifier = controller.provider
        .getAllModels?.()
        .find((model) => model.type === "classifier");
      if (classifier?.type !== "classifier") throw new Error("missing classifier model");
      const result = yield* awaited(
        controller.provider.classify!(
          { ...classifier, baseUrl: `${url}/v1` },
          {
            questions: {
              kind: {
                criteria: { billing: "", ci: "" },
                instructions: "What is this about?",
                type: "choice" as const,
              },
            },
            state: { message: "The build is red again." },
          },
          { apiKey: "local" },
        ),
      );
      expect(result.errorMessage).toBeUndefined();
      expect(result.answers["kind"]).toMatchObject({ choice: "ci", type: "choice" as const });
      expect(paths).toContain("/completion");
    }),
  );

const decisionCatalog = {
  data: [
    {
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      id: "qwen",
      meta: { n_ctx: 32768 },
      status: { value: "loaded" },
    },
    {
      architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
      id: "kev",
      meta: { n_ctx: 8192 },
      status: { value: "loaded" },
    },
    {
      architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
      id: "laya",
      status: { value: "sleeping" },
    },
    { id: "legacy", status: { value: "loaded" } },
  ],
};

const systemOneReply = (payload: Readonly<Record<string, unknown>>) => {
  const questions = payload["questions"];
  const ids = typeof questions === "object" && questions !== null ? Object.keys(questions) : [];
  return {
    answers: Object.fromEntries(ids.map((id) => [id, { noul: 0.82, type: "noul" as const }])),
    model: payload["model"],
    usage: { input_tokens: 42, output_tokens: 0 },
  };
};

const decisionServer = (propsModels: string[], systemOneRequests: unknown[]) =>
  serve(({ json: payload, url }) => {
    if (url.pathname === "/models") return decisionCatalog;
    if (url.pathname === "/props") {
      propsModels.push(url.searchParams.get("model") ?? "");
      return {};
    }
    if (url.pathname !== "/v1/systemone") return undefined;
    systemOneRequests.push(payload);
    return systemOneReply(payload);
  });

const angryQuestion = {
  criteria: { false: "calm", true: "angry" },
  instructions: "Is the customer angry?",
};

const classifyWithKev = (controller: ReturnType<typeof createLlamaProvider>) =>
  Effect.gen(function* () {
    const kev = controller.provider.getAllModels?.().find((model) => model.id === "kev");
    if (kev?.type !== "classifier") throw new Error("missing decision classifier model");
    expect(kev.contextWindow).toBe(8192);
    return yield* awaited(
      controller.provider.classify!(
        kev,
        {
          questions: { angry: { ...angryQuestion, type: "bool" as const } },
          state: { message: "I was charged twice." },
        },
        { apiKey: "local" },
      ),
    );
  });

const exposesDecisionModelsReportedByTheCatalog = () =>
  runTest(
    Effect.gen(function* () {
      const propsModels: string[] = [];
      const systemOneRequests: unknown[] = [];
      const url = yield* decisionServer(propsModels, systemOneRequests);
      const cache = createCache();
      const controller = createLlamaProvider();
      yield* refresh(controller, { publish: cache.publish, url });
      expect(systemOneRequests).toEqual([]);
      expect(propsModels.sort()).toEqual(["legacy", "qwen"]);
      expect(controller.provider.getModels().map((model) => model.id)).toEqual(["qwen", "legacy"]);
      expect(cache.entry()?.models.map((model) => [model.id, model.api, model.baseUrl])).toEqual([
        ["qwen", "openai-completions", `${url}/v1`],
        ["legacy", "openai-completions", `${url}/v1`],
        ["qwen", "llama-cpp-classify", url],
        ["kev", "typesafe-system-one", `${url}/v1`],
        ["laya", "typesafe-system-one", `${url}/v1`],
        ["legacy", "llama-cpp-classify", url],
      ]);
      const result = yield* classifyWithKev(controller);
      expect(result.errorMessage).toBeUndefined();
      expect(result.answers["angry"]).toEqual({ probability: 0.82, type: "bool" as const });
      expect(result.usage).toMatchObject({ input: 42, output: 0 });
      expect(systemOneRequests).toEqual([
        {
          model: "kev",
          questions: { angry: { ...angryQuestion, type: "noul" as const } },
          state: { message: "I was charged twice." },
        },
      ]);
    }),
  );

const restoresDecisionModelsFromTheCache = () =>
  runTest(
    Effect.gen(function* () {
      const url = yield* decisionServer([], []);
      const cache = createCache();
      yield* refresh(createLlamaProvider(), { publish: cache.publish, url });
      const restored = createLlamaProvider();
      yield* refresh(restored, {
        allowNetwork: false,
        publish: cache.publish,
        stored: cache.entry(),
        url,
      });
      expect(restored.provider.getModels().map((model) => model.id)).toEqual(["qwen", "legacy"]);
      expect(
        restored.provider
          .getAllModels?.()
          .filter((model) => model.type === "classifier")
          .map((model) => [model.id, model.api]),
      ).toEqual([
        ["qwen", "llama-cpp-classify"],
        ["kev", "typesafe-system-one"],
        ["laya", "typesafe-system-one"],
        ["legacy", "llama-cpp-classify"],
      ]);
    }),
  );

const listsDecisionModelsThatAlsoOutputText = () => {
  const controller = createLlamaProvider();
  controller.setCatalog(
    [
      {
        architecture: { output_modalities: ["decisions"] },
        id: "decide",
        status: { value: "sleeping" },
      },
      {
        architecture: { output_modalities: ["text", "decisions"] },
        id: "hybrid",
        status: { value: "loaded" },
      },
    ],
    "http://localhost:8080",
  );
  expect(controller.provider.getModels().map((model) => model.id)).toEqual(["hybrid"]);
  expect(
    controller.provider
      .getAllModels?.()
      .filter((model) => model.type === "classifier")
      .map((model) => [model.id, model.api]),
  ).toEqual([
    ["decide", "typesafe-system-one"],
    ["hybrid", "typesafe-system-one"],
  ]);
};

describe("llama.cpp extension", () => {
  it(
    "classifies with selectable models through llama-server",
    classifiesWithSelectableModelsThroughLlamaServer,
  );

  it(
    "exposes decision models reported by the catalog as native System One classifiers",
    exposesDecisionModelsReportedByTheCatalog,
  );

  it(
    "restores decision models from the cache without the network",
    restoresDecisionModelsFromTheCache,
  );

  it("lists decision models that also output text for chat", listsDecisionModelsThatAlsoOutputText);
});
