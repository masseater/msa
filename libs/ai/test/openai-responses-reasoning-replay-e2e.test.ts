import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";
import openaiResponsesReasoningReplayE2eSupport from "./openai-responses-reasoning-replay-e2e-support.ts";

const { complete, getEnvApiKey } = compat;

const { hasEnv } = env;
const { chooseModel, compatValue, modelsWhere, usesApi } = modelChoice;
const { answerAfterToolResult, askToDouble, doubleNumberTool, textOf } =
  openaiResponsesReasoningReplayE2eSupport;

const openaiKey = getEnvApiKey("openai");
const anthropicKey = getEnvApiKey("anthropic-api");

const reasoningResponsesModels = modelsWhere(
  "openai",
  (model) => usesApi("openai-responses")(model) && model.reasoning,
) as typesModule.Model<"openai-responses">[];
const [cheapReasoningModel, otherReasoningModel] = reasoningResponsesModels;
if (cheapReasoningModel === undefined || otherReasoningModel === undefined) {
  throw new Error("The openai catalog has fewer than two reasoning Responses models");
}
const budgetThinkingAnthropic = chooseModel(
  "anthropic-api",
  "budget thinking",
  (model) => model.reasoning && compatValue(model, "forceAdaptiveThinking") !== true,
);

const expectAnswered = (response: typesModule.AssistantMessage) => {
  expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
  expect(response.errorMessage).toBeFalsy();
  expect(response.content.length).toBeGreaterThan(0);
};

const skipsAbortedReasoningOnlyHistory = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const options = { apiKey: openaiKey, reasoningEffort: "high" };
      const { assistantResponse, userMessage } = yield* askToDouble(
        cheapReasoningModel,
        options,
        "You are a helpful assistant. Use the tool.",
      );
      const thinking = assistantResponse.content.find(
        (block) => block.type === "thinking" && block.thinkingSignature !== undefined,
      );
      if (thinking === undefined)
        throw new Error("Missing thinking signature from OpenAI Responses");
      const timestamp = yield* Clock.currentTimeMillis;
      const response = yield* Effect.promise(() =>
        complete(
          cheapReasoningModel,
          {
            messages: [
              userMessage,
              { ...assistantResponse, content: [thinking], stopReason: "aborted" },
              { content: "Say hello to confirm you can continue.", role: "user", timestamp },
            ],
            systemPrompt: "You are a helpful assistant.",
            tools: [doubleNumberTool],
          },
          options,
        ),
      );
      expectAnswered(response);
    }),
  );

const handsOffBetweenOpenAIModels = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const options = { apiKey: openaiKey, reasoningEffort: "high" };
      const history = yield* askToDouble(cheapReasoningModel, options);
      const response = yield* answerAfterToolResult(history, otherReasoningModel, options);
      expectAnswered(response);
      expect(textOf(response)).toContain("42");
    }),
  );

const handsOffFromAnthropic = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const history = yield* askToDouble(budgetThinkingAnthropic, {
        apiKey: anthropicKey,
        thinkingBudgetTokens: 5000,
        thinkingEnabled: true,
      });
      const response = yield* answerAfterToolResult(history, otherReasoningModel, {
        apiKey: openaiKey,
        reasoningEffort: "high",
      });
      expectAnswered(response);
      expect(textOf(response)).toContain("42");
    }),
  );

describe.skipIf(!hasEnv("OPENAI_API_KEY") || !hasEnv("ANTHROPIC_API_KEY"))(
  "OpenAI Responses reasoning replay e2e",
  () => {
    it(
      "skips reasoning-only history after an aborted turn",
      { retry: 2 },
      skipsAbortedReasoningOnlyHistory,
    );
    it(
      "handles same-provider different-model handoff with tool calls",
      { retry: 2 },
      handsOffBetweenOpenAIModels,
    );
    it(
      "handles cross-provider handoff from Anthropic to OpenAI Codex",
      { retry: 2 },
      handsOffFromAnthropic,
    );
  },
);
