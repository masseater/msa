import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiCompletionsCompat from "../src/api/openai-completions-compat.ts";
import openaiCompletions from "../src/api/openai-completions.ts";
import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import modelChoice from "./model-choice.ts";
import openaiCompletionsToolChoiceSupport from "./openai-completions-tool-choice-support.ts";

const { convertMessages } = openaiCompletions;
const { normalizeContext } = compatModule;
const { currentTimeMillis } = clock;
const { getCompat } = openaiCompletionsCompat;

vi.mock("openai", () =>
  import("./openai-completions-tool-choice-mock.ts").then((module) => module.default),
);

const { chooseModel, compatValue, modelsWhere, usesApi } = modelChoice;
const { promptModel, resetMockStateBeforeEach } = openaiCompletionsToolChoiceSupport;

const emptyUsage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

const openCodeGoReasoningModel = (): typesModule.Model<"openai-completions"> => {
  const { compat: _compat, ...baseModel } = chooseModel(
    "opencode-go",
    "reasoning completions",
    (model) => usesApi("openai-completions")(model) && model.reasoning,
  );
  return { ...baseModel, api: "openai-completions" };
};

const replaysThinkingAsReasoningContent = () => {
  const model = openCodeGoReasoningModel();
  const [message] = convertMessages(
    model,
    normalizeContext({
      messages: [
        {
          api: model.api,
          content: [
            { thinking: "think", thinkingSignature: "reasoning", type: "thinking" },
            { arguments: { path: "README.md" }, id: "call_1", name: "read", type: "toolCall" },
          ],
          model: model.id,
          provider: model.provider,
          role: "assistant",
          stopReason: "stop",
          timestamp: currentTimeMillis(),
          usage: emptyUsage,
        },
      ],
    }),
    getCompat(model),
  );
  expect(message).toMatchObject({ reasoning_content: "think", role: "assistant" });
  expect(message).not.toHaveProperty("reasoning");
};

const deepseekThinkingModel = () =>
  chooseModel(
    "opencode",
    "deepseek-format thinking completions",
    (model) =>
      usesApi("openai-completions")(model) && compatValue(model, "thinkingFormat") === "deepseek",
  );

const sendsThinkingToggle = (reasoning: "high" | undefined, thinking: string) => () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* promptModel(deepseekThinkingModel(), "Hi", {
        options: reasoning === undefined ? {} : { reasoning },
      });
      expect(payload["thinking"]).toEqual({ type: thinking });
      expect(payload["reasoning_effort"]).toBeUndefined();
    }),
  );

const maxTokensModel = (provider: "opencode" | "opencode-go") =>
  chooseModel(
    provider,
    "max_tokens completions",
    (model) =>
      usesApi("openai-completions")(model) && compatValue(model, "maxTokensField") === "max_tokens",
  );

const sendsMaxTokens = (provider: "opencode" | "opencode-go") =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* promptModel(maxTokensModel(provider), "Hi", {
        options: { maxTokens: 123 },
      });
      expect(payload["max_tokens"]).toBe(123);
      expect(payload["max_completion_tokens"]).toBeUndefined();
    }),
  );

const omitsUnsupportedReasoningEffort = () =>
  Effect.runPromise(
    Effect.forEach(
      modelsWhere("opencode", (model) => compatValue(model, "supportsReasoningEffort") === false),
      (model) =>
        Effect.gen(function* () {
          const { payload } = yield* promptModel(model, "Hi", { options: { reasoning: "high" } });
          expect(payload["reasoning_effort"], model.id).toBeUndefined();
        }),
    ),
  );

describe("openai-completions tool_choice", () => {
  resetMockStateBeforeEach();

  it(
    "replays OpenCode Go reasoning thinking blocks as reasoning_content",
    replaysThinkingAsReasoningContent,
  );
  it(
    "sends thinking disabled for OpenCode deepseek-format models when thinking is off",
    sendsThinkingToggle(undefined, "disabled"),
  );
  it(
    "sends thinking enabled for OpenCode deepseek-format models when thinking is enabled",
    sendsThinkingToggle("high", "enabled"),
  );
  it.for(["opencode", "opencode-go"] as const)(
    "sends max_tokens for %s completions models",
    sendsMaxTokens,
  );
  it(
    "omits reasoning effort for OpenCode models without reasoning effort support",
    omitsUnsupportedReasoningEffort,
  );
});
