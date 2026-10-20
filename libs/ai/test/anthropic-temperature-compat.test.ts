import { Data, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { streamSimple } from "../src/compat.ts";
import type { Context, Model, SimpleStreamOptions } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import modelChoice from "./model-choice.ts";

const { compatValue, modelsWhere, usesApi } = modelChoice;

interface AnthropicTemperaturePayload {
  temperature?: number;
}

class PayloadCaptured extends Data.TaggedError("PayloadCaptured")<{ readonly message: string }> {}

function makeContext(): Context {
  return {
    messages: [{ content: "Hello", role: "user", timestamp: currentTimeMillis() }],
  };
}

function makeCustomModel(
  compat?: Model<"anthropic-messages">["compat"],
): Model<"anthropic-messages"> {
  return {
    api: "anthropic-messages",
    baseUrl: "http://127.0.0.1:9",
    compat,
    contextWindow: 200000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "vendor--claude-opus-4-7",
    input: ["text"],
    maxTokens: 32000,
    name: "Vendor Proxy Opus 4.7",
    provider: "vendor-proxy",
    reasoning: true,
  };
}

const capturePayload = Effect.fn("capturePayload")(function* (
  model: Model<"anthropic-messages">,
  options?: SimpleStreamOptions,
) {
  let capturedPayload: AnthropicTemperaturePayload | undefined;

  const payloadCaptureModel: Model<"anthropic-messages"> = {
    ...model,
    baseUrl: "http://127.0.0.1:9",
  };

  const s = streamSimple(payloadCaptureModel, makeContext(), {
    ...options,
    apiKey: "fake-key",
    onPayload: (payload) => {
      capturedPayload = payload as AnthropicTemperaturePayload;
      throw new PayloadCaptured({ message: "payload captured" });
    },
  });

  yield* Effect.promise(() => s.result());

  if (capturedPayload === undefined) {
    throw new Error("Expected payload to be captured before request failure");
  }

  return capturedPayload;
});

const anthropicModels = modelsWhere("anthropic-api", () => true).filter(
  usesApi("anthropic-messages"),
);
const rejectsTemperature = (model: Model<"anthropic-messages">) =>
  compatValue(model, "supportsTemperature") === false;
const keepsTemperature = (model: Model<"anthropic-messages">) =>
  !rejectsTemperature(model) && model.thinkingLevelMap?.off !== null;

describe("Anthropic temperature compatibility", () => {
  it("covers catalog models on both sides of supportsTemperature", () => {
    expect(anthropicModels.some(rejectsTemperature)).toBe(true);
    expect(anthropicModels.some(keepsTemperature)).toBe(true);
  });

  it.for(anthropicModels.filter(rejectsTemperature))("omits temperature for $id", (model) =>
    Effect.runPromise(
      Effect.gen(function* () {
        for (const temperature of [0, 1]) {
          const payload = yield* capturePayload(model, { temperature });
          expect(payload.temperature).toBeUndefined();
        }
      }),
    ),
  );

  it.for(anthropicModels.filter(keepsTemperature))("keeps temperature for $id", (model) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(model, { temperature: 0 });
        expect(payload.temperature).toBe(0);
      }),
    ),
  );

  it("omits temperature for custom models with supportsTemperature disabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeCustomModel({ supportsTemperature: false }), {
          temperature: 0,
        });

        expect(payload.temperature).toBeUndefined();
      }),
    ));
});
