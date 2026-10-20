import { Effect } from "effect";
import { describe, inject, it } from "vite-plus/test";

import type { Api, Model, StreamOptions } from "../src/types.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";
import streamScenarios from "./stream-scenarios.ts";

const { hasEnv, hasValue } = env;
const { chooseModel, usesApi } = modelChoice;
const {
  basicTextGeneration,
  handleImage,
  handleStreaming,
  handleThinking,
  handleToolCall,
  multiTurn,
} = streamScenarios;

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

interface Target {
  readonly available: boolean;
  readonly basic?: StreamOptionsWithExtras;
  readonly label: string;
  readonly model: Model<Api>;
  readonly options: StreamOptionsWithExtras;
  readonly thinking?: StreamOptionsWithExtras;
}

const openaiCodexToken = inject("storedApiKeys")["openai-codex"];

const reasoningVision = (model: Model<Api>) => model.reasoning && model.input.includes("image");

const directCompletions = (): Model<"openai-completions"> => {
  const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
  return { ...baseModel, api: "openai-completions" };
};

const codexModel = chooseModel(
  "openai-codex",
  "xhigh vision Codex",
  (model) => reasoningVision(model) && typeof model.thinkingLevelMap?.xhigh === "string",
);

const targets: Target[] = [
  {
    available: hasEnv("OPENAI_API_KEY"),
    label: "OpenAI Completions",
    model: directCompletions(),
    options: {},
  },
  {
    available: hasEnv("OPENAI_API_KEY"),
    label: "OpenAI Responses",
    model: chooseModel(
      "openai",
      "reasoning vision Responses",
      (model) => usesApi("openai-responses")(model) && reasoningVision(model),
    ),
    options: {},
    thinking: { reasoningEffort: "high" },
  },
  {
    available: hasEnv("ANTHROPIC_API_KEY"),
    basic: { thinkingEnabled: true },
    label: "Anthropic",
    model: chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages")),
    options: {},
  },
  {
    available: hasEnv("OPENROUTER_API_KEY"),
    label: "OpenRouter",
    model: chooseModel(
      "openrouter",
      "reasoning vision completions",
      (model) => usesApi("openai-completions")(model) && reasoningVision(model),
    ),
    options: {},
    thinking: { reasoningEffort: "medium" },
  },
  {
    available: hasValue(openaiCodexToken),
    label: "OpenAI Codex",
    model: codexModel,
    options: { apiKey: openaiCodexToken },
    thinking: { reasoningEffort: "xhigh" },
  },
  {
    available: hasValue(openaiCodexToken),
    label: "OpenAI Codex via WebSocket",
    model: codexModel,
    options: { apiKey: openaiCodexToken, transport: "websocket" },
    thinking: { reasoningEffort: "xhigh" },
  },
];

describe.each(targets)("Generate E2E Tests: $label", (target) => {
  const run =
    (
      scenario: (model: Model<Api>, options: StreamOptionsWithExtras) => Effect.Effect<void>,
      extra = {},
    ) =>
    () =>
      Effect.runPromise(scenario(target.model, { ...target.options, ...extra }));
  const skipped = !target.available;
  const thinking = target.thinking;

  it.skipIf(skipped)(
    "should complete basic text generation",
    { retry: 3 },
    run(basicTextGeneration, target.basic),
  );
  it.skipIf(skipped)("should handle tool calling", { retry: 3 }, run(handleToolCall));
  it.skipIf(skipped)("should handle streaming", { retry: 3 }, run(handleStreaming));
  it.skipIf(skipped || thinking === undefined)(
    "should handle thinking",
    { retry: 2 },
    run(handleThinking, thinking),
  );
  it.skipIf(skipped || thinking === undefined)(
    "should handle multi-turn with thinking and tools",
    { retry: 3 },
    run(multiTurn, thinking),
  );
  it.skipIf(skipped)("should handle image input", { retry: 3 }, run(handleImage));
});
