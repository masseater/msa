import { Effect } from "effect";
import { describe, it } from "vite-plus/test";

import env from "./env.ts";
import imageToolResultSupport from "./image-tool-result-support.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel, usesApi } = modelChoice;

const { handleToolWithImageResult, handleToolWithTextAndImageResult } = imageToolResultSupport;
const { envValue } = env;

describe("Tool Results with Images", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider (gpt-5-mini)",
    () => {
      const llm = chooseModel(
        "openai",
        "vision reasoning Responses",
        (model) =>
          usesApi("openai-responses")(model) && model.reasoning && model.input.includes("image"),
      );

      it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithImageResult(llm)),
      );

      it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithTextAndImageResult(llm)),
      );
    },
  );
});
