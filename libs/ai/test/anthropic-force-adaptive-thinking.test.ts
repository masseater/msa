import { Effect, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import modelChoice from "./model-choice.ts";

const { currentTimeMillis } = clock;
const { streamSimple } = compatModule;

const { chooseModel, compatValue, usesApi } = modelChoice;

const xhighAdaptiveModel = () =>
  chooseModel(
    "anthropic-api",
    "adaptive xhigh without mid-conversation effort",
    (candidate) =>
      usesApi("anthropic-messages")(candidate) &&
      compatValue(candidate, "forceAdaptiveThinking") === true &&
      compatValue(candidate, "supportsMidConvoEffort") !== true &&
      typeof candidate.thinkingLevelMap?.xhigh === "string",
  );

const adaptiveModel = () =>
  chooseModel(
    "anthropic-api",
    "adaptive without mid-conversation effort",
    (candidate) =>
      usesApi("anthropic-messages")(candidate) &&
      compatValue(candidate, "forceAdaptiveThinking") === true &&
      compatValue(candidate, "supportsMidConvoEffort") !== true,
  );

interface AnthropicThinkingPayload {
  thinking?: { type: string; budget_tokens?: number; display?: string };
  output_config?: { effort?: string };
}

class PayloadCaptured extends Schema.TaggedError<
  PayloadCaptured,
  { readonly brand: unique symbol }
>()("PayloadCaptured", { message: Schema.String }) {}

function makeContext(): typesModule.Context {
  return {
    messages: [{ content: "Hello", role: "user", timestamp: currentTimeMillis() }],
  };
}

function makeCustomModel(
  compat?: typesModule.Model<"anthropic-messages">["compat"],
): typesModule.Model<"anthropic-messages"> {
  return {
    api: "anthropic-messages",
    baseUrl: "http://127.0.0.1:9",
    compat,
    contextWindow: 200000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "vendor--claude-opus-latest",
    input: ["text"],
    maxTokens: 32000,
    name: "Vendor Proxy Opus Latest",
    provider: "vendor-proxy",
    reasoning: true,
  };
}

const capturePayload = Effect.fn("capturePayload")(function* (
  model: typesModule.Model<"anthropic-messages">,
  options?: typesModule.SimpleStreamOptions,
) {
  let capturedPayload: AnthropicThinkingPayload | undefined;

  const payloadCaptureModel: typesModule.Model<"anthropic-messages"> = {
    ...model,
    baseUrl: "http://127.0.0.1:9",
  };

  const s = streamSimple(payloadCaptureModel, makeContext(), {
    ...options,
    apiKey: "fake-key",
    onPayload: (payload) => {
      capturedPayload = payload as AnthropicThinkingPayload;
      throw PayloadCaptured.make({ message: "payload captured" });
    },
  });

  yield* Effect.promise(() => s.result());

  if (capturedPayload === undefined) {
    throw new Error("Expected payload to be captured before request failure");
  }

  return capturedPayload;
});

describe("Anthropic forceAdaptiveThinking compat override", () => {
  it("sends legacy thinking payload for custom model ids by default", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeCustomModel(), { reasoning: "medium" });

        expect(payload.thinking?.type).toBe("enabled");
        expect(payload.output_config).toBeUndefined();
      }),
    ));

  it("sends adaptive thinking payload when compat.forceAdaptiveThinking is true", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeCustomModel({ forceAdaptiveThinking: true }), {
          reasoning: "medium",
        });

        expect(payload.thinking).toEqual({ display: "summarized", type: "adaptive" });
        expect(payload.output_config).toEqual({ effort: "medium" });
      }),
    ));

  it("uses adaptive thinking with native xhigh effort for Claude Fable 5", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(xhighAdaptiveModel(), {
          reasoning: "xhigh",
        });

        expect(payload.thinking).toEqual({ display: "summarized", type: "adaptive" });
        expect(payload.output_config).toEqual({ effort: "xhigh" });
      }),
    ));

  it("allows built-in adaptive models to opt out with compat.forceAdaptiveThinking false", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model: typesModule.Model<"anthropic-messages"> = {
          ...adaptiveModel(),
          compat: { forceAdaptiveThinking: false },
        };
        const payload = yield* capturePayload(model, { reasoning: "medium" });

        expect(payload.thinking?.type).toBe("enabled");
        expect(payload.output_config).toBeUndefined();
      }),
    ));
});

describe("Anthropic forceAdaptiveThinking compat override", () => {
  it("preserves thinking.type=disabled when reasoning is off regardless of override", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeCustomModel({ forceAdaptiveThinking: true }));

        expect(payload.thinking).toEqual({ type: "disabled" });
        expect(payload.output_config).toBeUndefined();
      }),
    ));
});
