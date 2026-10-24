import { describe, it } from "vite-plus/test";

import liveAuth from "./live-auth.ts";
import modelChoice from "./model-choice.ts";
import unicodeSurrogateSupport from "./unicode-surrogate-support.ts";

const { hasLiveAuth } = liveAuth;

const { chooseModel, usesApi } = modelChoice;

const { testEmojiInToolResults, testRealWorldLinkedInData, testUnpairedHighSurrogate } =
  unicodeSurrogateSupport;

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(!hasLiveAuth("anthropic-api"))("Anthropic Provider Unicode Handling", () => {
    const llm = chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages"));

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
  });
});
