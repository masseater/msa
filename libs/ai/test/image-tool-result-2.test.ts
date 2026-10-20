import { Effect } from "effect";
import { describe, it } from "vite-plus/test";

import { getModel } from "../src/compat.ts";
import env from "./env.ts";
import imageToolResultSupport from "./image-tool-result-support.ts";

const { handleToolWithImageResult, handleToolWithTextAndImageResult } = imageToolResultSupport;
const { envValue } = env;

describe("Tool Results with Images", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider (gpt-5-mini)",
    () => {
      const llm = getModel("openai", "gpt-5-mini");

      it("should handle tool result with only image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithImageResult(llm)),
      );

      it("should handle tool result with text and image", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(handleToolWithTextAndImageResult(llm)),
      );
    },
  );
});
