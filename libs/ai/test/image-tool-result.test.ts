import { Effect } from "effect";
import { describe, it } from "vite-plus/test";

import type compatTypes from "../src/compat.types.ts";
import env from "./env.ts";
import imageToolResultSupport from "./image-tool-result-support.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel } = modelChoice;

const { handleToolWithImageResult, handleToolWithTextAndImageResult } = imageToolResultSupport;
const { envValue } = env;

describe("Tool Results with Images", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider (gpt-4o-mini)",
    () => {
      const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
      void _compat;
      const llm: compatTypes.Model<"openai-completions"> = {
        ...baseModel,
        api: "openai-completions",
      };

      it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithImageResult(llm)),
      );

      it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithTextAndImageResult(llm)),
      );
    },
  );
});
