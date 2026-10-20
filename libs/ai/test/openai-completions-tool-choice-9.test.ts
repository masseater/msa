import { Clock, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { streamSimple } from "../src/compat.ts";
import type { Model, SimpleStreamOptions } from "../src/types.ts";
import openaiCompletionsToolChoiceMock from "./openai-completions-tool-choice-mock.ts";
import openaiCompletionsToolChoiceSupport from "./openai-completions-tool-choice-support.ts";

const { localOpenAICompletionsModel } = openaiCompletionsToolChoiceSupport;

vi.mock("openai", () =>
  import("./openai-completions-tool-choice-mock.ts").then((module) => module.default),
);

const { mockState } = openaiCompletionsToolChoiceMock;

type CapturedParams = {
  chat_template_kwargs?: Record<string, unknown>;
  thinking?: unknown;
  reasoning_effort?: string;
};

const captureSimpleParams = Effect.fn("captureSimpleParams")(function* (
  model: Model<"openai-completions">,
  reasoning?: SimpleStreamOptions["reasoning"],
) {
  const payload: { value: unknown } = { value: undefined };

  const currentTime = yield* Clock.currentTimeMillis;
  yield* Effect.promise(() =>
    streamSimple(
      model,
      {
        messages: [{ content: "Hi", role: "user", timestamp: currentTime }],
      },
      {
        apiKey: "test",
        onPayload: (params: unknown) => {
          payload.value = params;
        },
        reasoning,
      },
    ).result(),
  );

  return (payload.value ?? mockState.lastParams) as CapturedParams;
});

const usesConfigurableChatTemplateBooleanThinking = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = {
        ...localOpenAICompletionsModel,
        compat: {
          chatTemplateKwargs: { thinking: { $var: "thinking.enabled" } },
          supportsReasoningEffort: false,
          thinkingFormat: "chat-template",
        },
        id: "deepseek-ai/DeepSeek-V3.1",
        name: "DeepSeek V3.1 via vLLM",
      } satisfies Model<"openai-completions">;

      for (const testCase of [
        { expected: true, reasoning: "high" as const },
        { expected: false, reasoning: undefined },
      ]) {
        const params = yield* captureSimpleParams(model, testCase.reasoning);

        expect(params.chat_template_kwargs).toEqual({ thinking: testCase.expected });
        expect(params.thinking).toBeUndefined();
        expect(params.reasoning_effort).toBeUndefined();
      }
    }),
  );

const usesQwenChatTemplateThinkingKwargs = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = {
        ...localOpenAICompletionsModel,
        compat: {
          supportsReasoningEffort: false,
          thinkingFormat: "qwen-chat-template",
        },
        id: "Qwen/Qwen3-Coder",
        name: "Qwen3 Coder via vLLM",
      } satisfies Model<"openai-completions">;

      for (const testCase of [
        { expected: true, reasoning: "high" as const },
        { expected: false, reasoning: undefined },
      ]) {
        const params = yield* captureSimpleParams(model, testCase.reasoning);

        expect(params.chat_template_kwargs).toEqual({
          enable_thinking: testCase.expected,
          preserve_thinking: true,
        });
        expect(params.reasoning_effort).toBeUndefined();
      }
    }),
  );

const usesConfigurableChatTemplateEffortKwargs = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = {
        ...localOpenAICompletionsModel,
        compat: {
          chatTemplateKwargs: {
            preserve_thinking: true,
            reasoning_effort: { $var: "thinking.effort", omitWhenOff: true },
          },
          supportsReasoningEffort: false,
          thinkingFormat: "chat-template",
        },
        id: "unsloth/gpt-oss-120b-GGUF",
        name: "GPT OSS via vLLM",
        thinkingLevelMap: { xhigh: "max" },
      } satisfies Model<"openai-completions">;

      const params = yield* captureSimpleParams(model, "xhigh");

      expect(params.chat_template_kwargs).toEqual({
        preserve_thinking: true,
        reasoning_effort: "max",
      });
      expect(params.reasoning_effort).toBeUndefined();
    }),
  );

describe("openai-completions tool_choice", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.chunks = undefined;
  });
  it(
    "uses configurable chat template boolean thinking kwargs",
    usesConfigurableChatTemplateBooleanThinking,
  );
});

describe("openai-completions tool_choice", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.chunks = undefined;
  });
  it("uses qwen chat template thinking kwargs", usesQwenChatTemplateThinkingKwargs);
});

describe("openai-completions tool_choice", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.chunks = undefined;
  });
  it(
    "uses configurable chat template effort kwargs with static kwargs",
    usesConfigurableChatTemplateEffortKwargs,
  );
});
