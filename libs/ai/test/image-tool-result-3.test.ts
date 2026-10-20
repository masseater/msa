import { Effect } from "effect";
import { describe, it } from "vite-plus/test";

import { getModel } from "../src/compat.ts";
import env from "./env.ts";
import imageToolResultSupport from "./image-tool-result-support.ts";

const { handleToolWithImageResult, handleToolWithTextAndImageResult } = imageToolResultSupport;
const { envValue } = env;

describe("Tool Results with Images", () => {
  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider (claude-haiku-4-5)", () => {
    const model = getModel("anthropic-api", "claude-haiku-4-5");

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(model)),
    );

    it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(model)),
    );
  });

  describe.skipIf(
    envValue("OPENROUTER_API_KEY") === undefined || envValue("OPENROUTER_API_KEY") === "",
  )("OpenRouter Provider (glm-4.5v)", () => {
    const llm = getModel("openrouter", "z-ai/glm-4.5v");

    it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithImageResult(llm)),
    );

    it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(handleToolWithTextAndImageResult(llm)),
    );
  });
});
