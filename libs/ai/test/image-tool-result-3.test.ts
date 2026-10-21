import { Effect } from "effect";
import { describe, it } from "vite-plus/test";

import env from "./env.ts";
import imageToolResultSupport from "./image-tool-result-support.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel, usesApi } = modelChoice;

const { handleToolWithImageResult, handleToolWithTextAndImageResult } = imageToolResultSupport;
const { envValue } = env;

describe("Tool Results with Images", () => {
  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider (claude-haiku-4-5)", () => {
    const model = chooseModel(
      "anthropic-api",
      "vision Messages",
      (candidate) => usesApi("anthropic-messages")(candidate) && candidate.input.includes("image"),
    );

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(model)),
    );

    it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(model)),
    );
  });

  describe.skipIf(
    envValue("OPENROUTER_API_KEY") === undefined || envValue("OPENROUTER_API_KEY") === "",
  )("OpenRouter Provider (vision Completions)", () => {
    const llm = chooseModel(
      "openrouter",
      "vision Completions",
      (candidate) => usesApi("openai-completions")(candidate) && candidate.input.includes("image"),
    );

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(llm)),
    );

    it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(llm)),
    );
  });
});
