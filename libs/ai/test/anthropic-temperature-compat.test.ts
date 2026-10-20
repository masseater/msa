import { Data, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { getModel, streamSimple } from "../src/compat.ts";
import type { Context, Model, SimpleStreamOptions } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

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

describe("Anthropic temperature compatibility", () => {
  it("omits temperature for Claude Opus 4.7", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(getModel("anthropic-api", "claude-opus-4-7"), {
          temperature: 0,
        });

        expect(payload.temperature).toBeUndefined();
      }),
    ));

  it("omits temperature for Claude Opus 4.8", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(getModel("anthropic-api", "claude-opus-4-8"), {
          temperature: 0,
        });

        expect(payload.temperature).toBeUndefined();
      }),
    ));

  it("omits default temperature for Claude Opus 4.7", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(getModel("anthropic-api", "claude-opus-4-7"), {
          temperature: 1,
        });

        expect(payload.temperature).toBeUndefined();
      }),
    ));

  it("keeps temperature for Claude Opus 4.6", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(getModel("anthropic-api", "claude-opus-4-6"), {
          temperature: 0,
        });

        expect(payload.temperature).toBe(0);
      }),
    ));
});

describe("Anthropic temperature compatibility", () => {
  it("keeps temperature for Claude Sonnet 4.6", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(getModel("anthropic-api", "claude-sonnet-4-6"), {
          temperature: 0,
        });

        expect(payload.temperature).toBe(0);
      }),
    ));

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
