import { Effect } from "effect";
import { describe, inject, it } from "vite-plus/test";

import imageToolResultSupport from "./image-tool-result-support.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel } = modelChoice;

const { handleToolWithImageResult, handleToolWithTextAndImageResult } = imageToolResultSupport;
const openaiCodexToken = inject("storedApiKeys")["openai-codex"];

const gpt55ShouldHandleTool = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = chooseModel("openai-codex", "vision Codex", (model) =>
        model.input.includes("image"),
      );
      yield* handleToolWithImageResult(llm, { apiKey: openaiCodexToken });
    }),
  );

const gpt55ShouldHandleTool2 = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = chooseModel("openai-codex", "vision Codex", (model) =>
        model.input.includes("image"),
      );
      yield* handleToolWithTextAndImageResult(llm, { apiKey: openaiCodexToken });
    }),
  );

describe("Tool Results with Images", () => {
  describe("OpenAI Codex Provider", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle tool result with only image",
      { retry: 3, timeout: 30000 },
      gpt55ShouldHandleTool,
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle tool result with text and image",
      { retry: 3, timeout: 30000 },
      gpt55ShouldHandleTool2,
    );
  });
});
