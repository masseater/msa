import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Model } from "../src/types.ts";
import modelChoice from "./model-choice.ts";
import openaiCompletionsToolChoiceSupport from "./openai-completions-tool-choice-support.ts";

vi.mock("openai", () =>
  import("./openai-completions-tool-choice-mock.ts").then((module) => module.default),
);

const { chooseModel, compatValue, usesApi } = modelChoice;
const { directCompletionsModel, mockState, promptModel, resetMockStateBeforeEach } =
  openaiCompletionsToolChoiceSupport;

const cachedUsage = {
  completion_tokens: 5,
  completion_tokens_details: { reasoning_tokens: 0 },
  prompt_tokens: 100,
  prompt_tokens_details: { cache_write_tokens: 30, cached_tokens: 50 },
};

const doesNotDoubleCountReasoningTokens = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunks = [
        {
          choices: [{ delta: {}, finish_reason: "stop" }],
          id: "chatcmpl-reasoning-usage",
          usage: {
            completion_tokens: 33,
            completion_tokens_details: { reasoning_tokens: 21 },
            prompt_tokens: 10,
            prompt_tokens_details: { cached_tokens: 0 },
          },
        },
      ];
      const { response } = yield* promptModel(directCompletionsModel(), "Use reasoning.");
      expect(response.usage).toMatchObject({ input: 10, output: 33, totalTokens: 43 });
    }),
  );

const preservesCacheUsage = (usagePlacement: "chunk" | "choice") => () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const id = `chatcmpl-cache-write-${usagePlacement}`;
      mockState.chunks = [
        { choices: [{ delta: { content: "OK" }, finish_reason: null }], id },
        usagePlacement === "chunk"
          ? { choices: [{ delta: {}, finish_reason: "stop" }], id, usage: cachedUsage }
          : { choices: [{ delta: {}, finish_reason: "stop", usage: cachedUsage }], id },
      ];
      const { response } = yield* promptModel(directCompletionsModel(), "Reply with exactly OK");
      expect(response.usage).toMatchObject({
        cacheRead: 50,
        cacheWrite: 30,
        input: 20,
        totalTokens: 105,
      });
    }),
  );

const usesOpenRouterReasoningObject = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = chooseModel(
        "openrouter",
        "openrouter-format reasoning",
        (candidate): candidate is Model<"openai-completions"> =>
          usesApi("openai-completions")(candidate) &&
          candidate.reasoning &&
          compatValue(candidate, "thinkingFormat") === "openrouter" &&
          candidate.thinkingLevelMap?.high === "high",
      );
      const { payload } = yield* promptModel(model, "Hi", { options: { reasoning: "high" } });
      expect(payload["reasoning"]).toEqual({ effort: "high" });
      expect(payload["reasoning_effort"]).toBeUndefined();
    }),
  );

describe("openai-completions tool_choice", () => {
  resetMockStateBeforeEach();

  it(
    "does not double-count reasoning tokens in completion usage",
    doesNotDoubleCountReasoningTokens,
  );
  it(
    "preserves prompt_tokens_details cache read/write fields from chunk usage",
    preservesCacheUsage("chunk"),
  );
  it(
    "preserves prompt_tokens_details cache read/write fields from choice usage fallback",
    preservesCacheUsage("choice"),
  );
  it("uses OpenRouter reasoning object instead of reasoning_effort", usesOpenRouterReasoningObject);
});
