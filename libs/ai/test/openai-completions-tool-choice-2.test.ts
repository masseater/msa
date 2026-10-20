import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Model } from "../src/types.ts";
import modelChoice from "./model-choice.ts";
import openaiCompletionsToolChoiceSupport from "./openai-completions-tool-choice-support.ts";

vi.mock("openai", () =>
  import("./openai-completions-tool-choice-mock.ts").then((module) => module.default),
);

const { chooseModel, compatValue, usesApi } = modelChoice;
const {
  chunkUsage,
  directCompletionsModel,
  mockState,
  optionalFieldTool,
  promptModel,
  resetMockStateBeforeEach,
} = openaiCompletionsToolChoiceSupport;

const openRouterCompletions = (
  wanted: string,
  accepts: (model: Model<"openai-completions">) => boolean,
) =>
  chooseModel(
    "openrouter",
    wanted,
    (model): model is Model<"openai-completions"> =>
      usesApi("openai-completions")(model) && accepts(model),
  );

const keepsStrictToolsForCapableModels = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = openRouterCompletions(
        "strict-capable completions",
        (candidate) => compatValue(candidate, "supportsStrictMode") === true,
      );
      const { payload } = yield* promptModel(model, "Call ping", { tools: [optionalFieldTool] });
      const functionTool = payload.tools?.[0]?.function;
      expect(functionTool?.strict).toBe(true);
      expect(functionTool?.parameters?.required).toEqual(["optional", "required"]);
    }),
  );

const mapsUnknownFinishReasonToError = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunks = [
        { choices: [{ delta: { content: "partial" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "network_error" }], usage: chunkUsage(1, 1) },
      ];
      const model = openRouterCompletions("completions", () => true);
      const { response } = yield* promptModel(model, "Hi");
      expect(response.stopReason).toBe("error");
      expect(response.errorMessage).toBe("Provider finish_reason: network_error");
    }),
  );

const ignoresNullChunks = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunks = [
        null,
        { choices: [{ delta: { content: "OK" }, finish_reason: null }], id: "chatcmpl-test" },
        {
          choices: [{ delta: {}, finish_reason: "stop" }],
          id: "chatcmpl-test",
          usage: chunkUsage(3, 1),
        },
      ];
      const { response } = yield* promptModel(directCompletionsModel(), "Reply with exactly OK");
      expect(response.stopReason).toBe("stop");
      expect(response.errorMessage).toBeUndefined();
      expect(response.responseId).toBe("chatcmpl-test");
      expect(response.usage.totalTokens).toBe(4);
      expect(response.content).toEqual([{ text: "OK", type: "text" }]);
    }),
  );

const errorsWithoutFinishReason = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const partial = {
        choices: [{ delta: { content: "partial answer" }, finish_reason: null }],
        id: "chatcmpl-truncated",
      };
      mockState.chunks = [partial, partial];
      const { response } = yield* promptModel(
        directCompletionsModel(),
        "Reply with a longer sentence",
      );
      expect(response.stopReason).toBe("error");
      expect(response.errorMessage).toBe("Stream ended without finish_reason");
    }),
  );

describe("openai-completions tool_choice", () => {
  resetMockStateBeforeEach();

  it(
    "preserves strict tools for capable built-in Chat Completions models",
    keepsStrictToolsForCapableModels,
  );
  it(
    "maps non-standard provider finish_reason values to stopReason error",
    mapsUnknownFinishReasonToError,
  );
  it("ignores null stream chunks from openai-compatible providers", ignoresNullChunks);
  it("errors when a stream ends after only null finish_reason chunks", errorsWithoutFinishReason);
});
