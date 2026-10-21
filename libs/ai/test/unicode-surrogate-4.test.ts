import { Effect } from "effect";
import { describe, inject, it } from "vite-plus/test";

import modelChoice from "./model-choice.ts";
import unicodeSurrogateSupport from "./unicode-surrogate-support.ts";

const { chooseModel } = modelChoice;

const { testEmojiInToolResults, testRealWorldLinkedInData, testUnpairedHighSurrogate } =
  unicodeSurrogateSupport;
const openaiCodexToken = inject("storedApiKeys")["openai-codex"];

const codexShouldHandleEmoji = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = chooseModel("openai-codex", "Codex");
      yield* Effect.promise(() => testEmojiInToolResults(llm, { apiKey: openaiCodexToken }));
    }),
  );

const codexShouldHandleReal = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = chooseModel("openai-codex", "Codex");
      yield* Effect.promise(() => testRealWorldLinkedInData(llm, { apiKey: openaiCodexToken }));
    }),
  );

const codexShouldHandleUnpaired = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = chooseModel("openai-codex", "Codex");
      yield* Effect.promise(() => testUnpairedHighSurrogate(llm, { apiKey: openaiCodexToken }));
    }),
  );

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe("OpenAI Codex Provider Unicode Handling", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "Codex - should handle emoji in tool results",
      { retry: 3, timeout: 30000 },
      codexShouldHandleEmoji,
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "Codex - should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      codexShouldHandleReal,
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "Codex - should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      codexShouldHandleUnpaired,
    );
  });
});
