import { Data, Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { streamSimple } from "../src/compat.ts";
import type { Context, Model, SimpleStreamOptions } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { envValue } = env;
const { chooseModel, compatValue, modelsWhere, usesApi } = modelChoice;

interface AnthropicThinkingPayload {
  thinking?: { type: string; budget_tokens?: number; display?: string };
  output_config?: { effort?: string };
}

class PayloadCaptured extends Data.TaggedError("PayloadCaptured")<{ readonly message: string }> {}

function makePayloadCaptureContext(): Context {
  return {
    messages: [{ content: "Hello", role: "user", timestamp: currentTimeMillis() }],
  };
}

const capturePayload = Effect.fn("capturePayload")(function* (
  model: Model<"anthropic-messages">,
  options?: SimpleStreamOptions,
) {
  let capturedPayload: AnthropicThinkingPayload | undefined;
  const payloadCaptureModel: Model<"anthropic-messages"> = {
    ...model,
    baseUrl: "http://127.0.0.1:9",
  };

  const s = streamSimple(payloadCaptureModel, makePayloadCaptureContext(), {
    ...options,
    apiKey: "fake-key",
    onPayload: (payload) => {
      capturedPayload = payload as AnthropicThinkingPayload;
      throw new PayloadCaptured({ message: "payload captured" });
    },
  });

  yield* Effect.promise(() => s.result());

  if (capturedPayload === undefined) {
    throw new Error("Expected payload to be captured before request failure");
  }

  return capturedPayload;
});

interface RunResult {
  thinkingEventCount: number;
  thinkingCharCount: number;
  text: string;
  contentTypes: string[];
}

function makeE2EContext(): Context {
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

function runWithoutReasoning(model: Model<"anthropic-messages">): Promise<RunResult> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const s = streamSimple(model, makeE2EContext(), {
        maxTokens: 160,
        temperature: 0,
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
        text,
        thinkingCharCount,
        thinkingEventCount,
      };
    }),
  );
}

const anthropicMessages = (accepts: (model: Model<"anthropic-messages">) => boolean) =>
  modelsWhere(
    "anthropic-api",
    (model) =>
      usesApi("anthropic-messages")(model) &&
      model.reasoning &&
      accepts(model as Model<"anthropic-messages">),
  ) as Model<"anthropic-messages">[];

const adaptive = (model: Model<"anthropic-messages">) =>
  compatValue(model, "forceAdaptiveThinking") === true &&
  compatValue(model, "supportsMidConvoEffort") !== true;
const offMapping = (model: Model<"anthropic-messages">) =>
  (model.thinkingLevelMap as Record<string, string | null> | undefined)?.["off"];

const disablesThinkingWhenOff = (model: Model<"anthropic-messages">) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const payload = yield* capturePayload(model);
      expect(payload.thinking).toEqual({ type: "disabled" });
      expect(payload.output_config).toBeUndefined();
    }),
  );

const omitsThinkingWhenOffIsUnsupported = (model: Model<"anthropic-messages">) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const payload = yield* capturePayload(model);
      expect(payload.thinking).toBeUndefined();
      expect(payload.output_config).toBeUndefined();
    }),
  );

const usesAdaptiveEffort = (reasoning: "high" | "xhigh") => (model: Model<"anthropic-messages">) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const payload = yield* capturePayload(model, { reasoning });
      expect(payload.thinking).toEqual({ display: "summarized", type: "adaptive" });
      expect(payload.output_config).toEqual({ effort: reasoning });
    }),
  );

describe("Anthropic thinking disable payload", () => {
  it.for(anthropicMessages((model) => model.thinkingLevelMap === undefined))(
    "sends thinking.type=disabled for budget-based $id when thinking is off",
    disablesThinkingWhenOff,
  );
  it.for(anthropicMessages((model) => adaptive(model) && offMapping(model) !== null))(
    "sends thinking.type=disabled for adaptive $id when thinking is off",
    disablesThinkingWhenOff,
  );
  it.for(
    anthropicMessages(
      (model) =>
        offMapping(model) === null && compatValue(model, "supportsMidConvoEffort") !== true,
    ),
  )(
    "omits thinking.type=disabled for $id, which cannot turn thinking off",
    omitsThinkingWhenOffIsUnsupported,
  );
  it.for(anthropicMessages(adaptive))(
    "uses adaptive thinking for $id when reasoning is enabled",
    usesAdaptiveEffort("high"),
  );
  it.for(
    anthropicMessages(
      (model) => adaptive(model) && typeof model.thinkingLevelMap?.xhigh === "string",
    ),
  )("maps xhigh reasoning to effort=xhigh for $id", usesAdaptiveEffort("xhigh"));
});

describe.skipIf(
  envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
)("Anthropic thinking disable E2E", () => {
  it("disables thinking for Claude reasoning models", { retry: 2, timeout: 30000 }, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          runWithoutReasoning(
            chooseModel(
              "anthropic-api",
              "budget-based reasoning",
              (model) =>
                usesApi("anthropic-messages")(model) &&
                model.reasoning &&
                model.thinkingLevelMap === undefined,
            ),
          ),
        );

        expect(result.thinkingEventCount).toBe(0);
        expect(result.thinkingCharCount).toBe(0);
        expect(result.contentTypes).not.toContain("thinking");
        expect(countPongs(result.text)).toBeGreaterThanOrEqual(35);
      }),
    ),
  );
});
