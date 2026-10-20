import { Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { streamSimple } from "../src/compat.ts";
import type { Context } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel, compatValue, usesApi } = modelChoice;

const adaptiveModel = () =>
  chooseModel(
    "anthropic-api",
    "adaptive thinking without mid-conversation effort",
    (candidate) =>
      usesApi("anthropic-messages")(candidate) &&
      compatValue(candidate, "forceAdaptiveThinking") === true &&
      compatValue(candidate, "supportsMidConvoEffort") !== true &&
      candidate.thinkingLevelMap?.off === undefined,
  );

const { envValue } = env;

interface AnthropicThinkingPayload {
  thinking?: { type: string };
  output_config?: { effort?: string };
}

function makeContext(): Context {
  return {
    messages: [
      {
        content:
          "Compute 48291 * 7317 and 90844 - 17729, add the results, and determine whether the sum is divisible by 11. Reply with exactly this format and nothing else: sum=<sum>; divisibleBy11=<yes|no>",
        role: "user",
        timestamp: currentTimeMillis(),
      },
    ],
    systemPrompt: "You are a precise assistant. Follow the user's instructions exactly.",
  };
}

describe.skipIf(
  envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
)("Anthropic adaptive thinking smoke", () => {
  it(
    "streams an adaptive thinking model with reasoning enabled",
    { retry: 2, timeout: 30000 },
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { thinkingSignature, response } = yield* streamsAdaptiveThinking();
          if (thinkingSignature === undefined || thinkingSignature === "") {
            throw new Error("Expected a thinking signature");
          }
          expect(thinkingSignature.length).toBeGreaterThan(0);

          const text = response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("")
            .trim();
          expect(text).toBe("sum=353418362; divisibleBy11=yes");
        }),
      ),
  );
});

const streamsAdaptiveThinking = () =>
  Effect.gen(function* () {
    const model = adaptiveModel();
    let capturedPayload: AnthropicThinkingPayload | undefined;
    const s = streamSimple(model, makeContext(), {
      maxTokens: 1024,
      onPayload: (payload) => {
        capturedPayload = payload as AnthropicThinkingPayload;
        return payload;
      },
      reasoning: "high",
    });

    let sawThinking = false;

    yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
      Stream.orDie,
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (
            event.type === "thinking_start" ||
            event.type === "thinking_delta" ||
            event.type === "thinking_end"
          ) {
            sawThinking = true;
          }
        }),
      ),
    );

    const response = yield* Effect.promise(() => s.result());
    expect(response.stopReason, response.errorMessage).toBe("stop");
    expect(response.errorMessage).toBeFalsy();
    expect(capturedPayload?.thinking).toEqual({ type: "adaptive" });
    expect(capturedPayload?.output_config).toEqual({ effort: "high" });
    expect(sawThinking).toBe(true);

    const thinkingBlock = response.content.find((block) => block.type === "thinking");
    expect(thinkingBlock?.type).toBe("thinking");
    if (thinkingBlock === undefined || thinkingBlock.type !== "thinking") {
      throw new Error("Expected thinking block from Claude Opus 4.8");
    }
    expect(typeof thinkingBlock.thinkingSignature).toBe("string");
    const thinkingSignature = thinkingBlock.thinkingSignature;
    return { response, thinkingSignature };
  });
