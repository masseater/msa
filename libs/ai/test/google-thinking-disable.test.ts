import { Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { streamSimple } from "../src/compat.ts";
import type { Api, Context, Model, SimpleStreamOptions } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel, compatValue, usesApi } = modelChoice;

const { envValue } = env;

type SimpleOptionsWithExtras = SimpleStreamOptions & Record<string, unknown>;

interface RunResult {
  thinkingEventCount: number;
  thinkingCharCount: number;
  text: string;
  outputTokens: number;
  contentTypes: string[];
}

interface DisableExpectations {
  requestOptions?: SimpleOptionsWithExtras | undefined;
  minPongs?: number;
  maxOutputTokens?: number;
}

function makeContext(): Context {
  return {
    messages: [
      {
        content:
          "Before replying, carefully solve 36863 * 5279 internally. Then reply with the word pong repeated exactly 40 times, separated by single spaces. Do not add any other text.",
        role: "user",
        timestamp: currentTimeMillis(),
      },
    ],
    systemPrompt: "You are a precise assistant. Follow the requested output format exactly.",
  };
}

function countPongs(text: string): number {
  return text.match(/\bpong\b/giu)?.length ?? 0;
}

function runWithoutReasoning<TApi extends Api>(
  model: Model<TApi>,
  options: SimpleOptionsWithExtras = {},
): Promise<RunResult> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const s = streamSimple(model, makeContext(), {
        maxTokens: 160,
        temperature: 0,
        ...options,
      });

      let thinkingEventCount = 0;
      let thinkingCharCount = 0;

      yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.type === "thinking_start" || event.type === "thinking_end") {
              thinkingEventCount += 1;
            }
            if (event.type === "thinking_delta") {
              thinkingEventCount += 1;
              thinkingCharCount += event.delta.length;
            }
          }),
        ),
      );

      const response = yield* Effect.promise(() => s.result());
      expect(response.stopReason, response.errorMessage).toBe("stop");

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      return {
        contentTypes: response.content.map((block) => block.type),
        outputTokens: response.usage.output,
        text,
        thinkingCharCount,
        thinkingEventCount,
      };
    }),
  );
}

const expectThinkingDisabledE2E = Effect.fn("expectThinkingDisabledE2E")(function* <
  TApi extends Api,
>(model: Model<TApi>, expectations: DisableExpectations = {}) {
  const result = yield* Effect.promise(() =>
    runWithoutReasoning(model, expectations.requestOptions),
  );

  expect(result.thinkingEventCount).toBe(0);
  expect(result.thinkingCharCount).toBe(0);
  expect(result.contentTypes).not.toContain("thinking");
  expect(countPongs(result.text)).toBeGreaterThanOrEqual(expectations.minPongs ?? 35);
  if (expectations.maxOutputTokens !== undefined) {
    expect(result.outputTokens).toBeLessThan(expectations.maxOutputTokens);
  }
});

describe.skipIf(
  envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
)("Anthropic thinking disable E2E", () => {
  it("disables thinking for budget-based reasoning models", { retry: 2, timeout: 30000 }, () =>
    Effect.runPromise(
      expectThinkingDisabledE2E(
        chooseModel(
          "anthropic-api",
          "budget-based reasoning",
          (candidate) =>
            usesApi("anthropic-messages")(candidate) &&
            candidate.reasoning &&
            candidate.thinkingLevelMap === undefined,
        ),
        {
          requestOptions: { maxTokens: 320, temperature: 0 },
        },
      ),
    ),
  );

  it("disables thinking for adaptive reasoning models", { retry: 2, timeout: 30000 }, () =>
    Effect.runPromise(
      expectThinkingDisabledE2E(
        chooseModel(
          "anthropic-api",
          "adaptive reasoning",
          (candidate) =>
            usesApi("anthropic-messages")(candidate) &&
            compatValue(candidate, "forceAdaptiveThinking") === true &&
            compatValue(candidate, "supportsMidConvoEffort") !== true,
        ),
        {
          requestOptions: { maxTokens: 320, temperature: 0 },
        },
      ),
    ),
  );
});

describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
  "OpenAI thinking disable E2E",
  () => {
    it("disables thinking for Responses reasoning models", { retry: 2, timeout: 30000 }, () =>
      Effect.runPromise(
        expectThinkingDisabledE2E(
          chooseModel(
            "openai",
            "reasoning Responses",
            (candidate) => usesApi("openai-responses")(candidate) && candidate.reasoning,
          ),
          {
            requestOptions: { temperature: undefined },
          },
        ),
      ),
    );
  },
);

describe.skipIf(
  envValue("OPENROUTER_API_KEY") === undefined || envValue("OPENROUTER_API_KEY") === "",
)("OpenRouter thinking disable E2E", () => {
  it("disables thinking for reasoning Completions models", { retry: 2, timeout: 30000 }, () =>
    Effect.runPromise(
      expectThinkingDisabledE2E(
        chooseModel(
          "openrouter",
          "reasoning Completions",
          (candidate) =>
            usesApi("openai-completions")(candidate) &&
            candidate.reasoning &&
            compatValue(candidate, "thinkingFormat") === "openrouter",
        ),
        {
          maxOutputTokens: 100,
        },
      ),
    ),
  );
});
