import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import type typesModule from "../src/types.types.ts";
import modelChoice from "./model-choice.ts";
import openaiCompletionsToolChoiceSupport from "./openai-completions-tool-choice-support.ts";

vi.mock("openai", () =>
  import("./openai-completions-tool-choice-mock.ts").then((module) => module.default),
);

const { chooseModel, compatValue, modelsWhere, usesApi } = modelChoice;
const { directCompletionsModel, mockState, promptModel, resetMockStateBeforeEach } =
  openaiCompletionsToolChoiceSupport;

const openRouterReasoning = (
  wanted: string,
  accepts: (model: typesModule.Model<"openai-completions">) => boolean,
) =>
  chooseModel(
    "openrouter",
    wanted,
    (model): model is typesModule.Model<"openai-completions"> =>
      usesApi("openai-completions")(model) && model.reasoning && accepts(model),
  );

const instructionRole = (model: typesModule.Model<"openai-completions">) =>
  Effect.gen(function* () {
    const { payload } = yield* promptModel(model, "Hi", { systemPrompt: "Follow instructions." });
    return payload.messages?.[0]?.["role"];
  });

const usesSystemRoleWithoutDeveloperSupport = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = openRouterReasoning(
        "reasoning without developer role",
        (candidate) => compatValue(candidate, "supportsDeveloperRole") === false,
      );
      expect(yield* instructionRole(model)).toBe("system");
    }),
  );

const keepsDeveloperRoleForVendor = (vendor: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = openRouterReasoning(`${vendor} reasoning`, (candidate) =>
        candidate.id.startsWith(`${vendor}/`),
      );
      expect(yield* instructionRole(model)).toBe("developer");
    }),
  );

const keepsDeveloperRoleForDirectReasoning = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { compat: _compat, ...baseModel } = chooseModel(
        "openai",
        "reasoning",
        (model) => model.reasoning,
      );
      expect(yield* instructionRole({ ...baseModel, api: "openai-completions" })).toBe("developer");
    }),
  );

const reasoningContentModelsAvoidDeveloperRole = () => {
  const models = modelsWhere(
    "openrouter",
    (model) => compatValue(model, "requiresReasoningContentOnAssistantMessages") === true,
  );
  expect(models.length).toBeGreaterThan(0);
  expect(models.map((model) => compatValue(model, "supportsDeveloperRole"))).toEqual(
    models.map(() => false),
  );
};

const reasoningDelta = (id: string) => [
  { choices: [{ delta: { reasoning: "think" }, finish_reason: "stop" }], id },
];

const normalizesOpenCodeGoReasoning = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunks = reasoningDelta("chatcmpl-opencode-go-reasoning");
      const { compat: _compat, ...baseModel } = chooseModel(
        "opencode-go",
        "reasoning completions",
        (model) => usesApi("openai-completions")(model) && model.reasoning,
      );
      const { response } = yield* promptModel(
        { ...baseModel, api: "openai-completions" },
        "Use reasoning.",
      );
      expect(response.content).toEqual([
        { thinking: "think", thinkingSignature: "reasoning_content", type: "thinking" },
      ]);
    }),
  );

const keepsOtherReasoningDeltas = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunks = reasoningDelta("chatcmpl-reasoning");
      const { response } = yield* promptModel(directCompletionsModel(), "Use reasoning.");
      expect(response.content).toEqual([
        { thinking: "think", thinkingSignature: "reasoning", type: "thinking" },
      ]);
    }),
  );

describe("openai-completions tool_choice", () => {
  resetMockStateBeforeEach();

  it(
    "uses system messages for non-OpenAI/Anthropic OpenRouter reasoning model instructions",
    usesSystemRoleWithoutDeveloperSupport,
  );
  it.for(["openai", "anthropic"])(
    "keeps developer messages for %s OpenRouter batch instructions",
    keepsDeveloperRoleForVendor,
  );
  it(
    "keeps developer messages for OpenAI reasoning model instructions",
    keepsDeveloperRoleForDirectReasoning,
  );
  it(
    "keeps OpenRouter models that require reasoning content off the developer role",
    reasoningContentModelsAvoidDeveloperRole,
  );
  it(
    "normalizes OpenCode Go reasoning deltas to reasoning_content for replay",
    normalizesOpenCodeGoReasoning,
  );
  it(
    "keeps non-OpenCode Go reasoning deltas on the original reasoning field",
    keepsOtherReasoningDeltas,
  );
});
