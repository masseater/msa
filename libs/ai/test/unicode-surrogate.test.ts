import { describe, it } from "vite-plus/test";

import env from "./env.ts";
import modelChoice from "./model-choice.ts";
import unicodeSurrogateSupport from "./unicode-surrogate-support.ts";

const { chooseModel } = modelChoice;

const { testEmojiInToolResults, testRealWorldLinkedInData, testUnpairedHighSurrogate } =
  unicodeSurrogateSupport;
const { envValue } = env;

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider Unicode Handling",
    () => {
      const llm = chooseModel("openai", "direct OpenAI");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );
});
