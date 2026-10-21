import { Data, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";

const { currentTimeMillis } = clock;
const { stream, streamSimple } = compat;

type DirectSamplingOptions = typesModule.StreamOptions & {
  reasoningEffort?: typesModule.ThinkingLevel;
  reasoningSummary?: "auto" | "detailed" | "concise" | null;
};

interface SamplingPayload {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  reasoning?: { effort?: string };
}

class PayloadCaptured extends Data.TaggedError("PayloadCaptured")<{ readonly message: string }> {}

function makeContext(): typesModule.Context {
  return {
    messages: [{ content: "Hello", role: "user", timestamp: currentTimeMillis() }],
  };
}

function makeModel(
  api: typesModule.Api,
  samplingParams?: Record<string, unknown>,
  overrides: Partial<typesModule.Model<typesModule.Api>> = {},
): typesModule.Model<typesModule.Api> {
  return {
    api,
    baseUrl: "http://127.0.0.1:9/v1",
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "custom-model",
    input: ["text"],
    maxTokens: 16384,
    name: "Custom Model",
    provider: "custom-provider",
    reasoning: false,
    ...(samplingParams === undefined ? {} : { samplingParams }),
    ...overrides,
  };
}

function capturingOptions(onCapture: (payload: SamplingPayload) => void) {
  return {
    apiKey: "fake-key",
    onPayload: (payload: unknown) => {
      onCapture(payload as SamplingPayload);
      throw new PayloadCaptured({ message: "payload captured" });
    },
  };
}

const capturePayload = Effect.fn("capturePayload")(function* (
  model: typesModule.Model<typesModule.Api>,
  options?: DirectSamplingOptions,
) {
  let capturedPayload: SamplingPayload | undefined;

  yield* Effect.promise(() =>
    stream(model, makeContext(), {
      ...options,
      ...capturingOptions((payload) => {
        capturedPayload = payload;
      }),
    }).result(),
  );

  if (capturedPayload === undefined) {
    throw new Error("Expected payload to be captured before request failure");
  }

  return capturedPayload;
});

const captureSimplePayload = Effect.fn("captureSimplePayload")(function* (
  model: typesModule.Model<typesModule.Api>,
  options?: typesModule.SimpleStreamOptions,
) {
  let capturedPayload: SamplingPayload | undefined;

  yield* Effect.promise(() =>
    streamSimple(model, makeContext(), {
      ...options,
      ...capturingOptions((payload) => {
        capturedPayload = payload;
      }),
    }).result(),
  );

  if (capturedPayload === undefined) {
    throw new Error("Expected payload to be captured before request failure");
  }

  return capturedPayload;
});

describe("sampling params", () => {
  it("merges request sampling params into the request body", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeModel("openai-completions"), {
          samplingParams: { min_p: 0, top_k: 0, top_p: 0.95 },
        });

        expect(payload.top_p).toBe(0.95);
        expect(payload.top_k).toBe(0);
        expect(payload.min_p).toBe(0);
      }),
    ));

  it("omits sampling params when neither options nor model set them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeModel("openai-completions"));

        expect(payload.temperature).toBeUndefined();
        expect(payload.top_p).toBeUndefined();
      }),
    ));

  it.each(["openai-completions", "openai-responses"] as const)(
    "applies model-level sampling params with request keys taking precedence for %s",
    (api) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const payload = yield* capturePayload(makeModel(api, { min_p: 0.05, top_p: 0.95 }), {
            samplingParams: { top_p: 0.5 },
          });

          expect(payload.top_p).toBe(0.5);
          expect(payload.min_p).toBe(0.05);
        }),
      ),
  );

  it("passes request sampling params through streamSimple", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* captureSimplePayload(makeModel("openai-completions"), {
          samplingParams: { top_p: 0.5 },
        });

        expect(payload.top_p).toBe(0.5);
      }),
    ));
});

describe("sampling params", () => {
  it("applies sampling params for the effective thinking level over model defaults", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* captureSimplePayload(
          makeModel(
            "openai-completions",
            { temperature: 1, top_p: 0.95 },
            {
              reasoning: true,
              samplingParamsByThinkingLevel: { high: { temperature: 0.8, top_k: 64 } },
              thinkingLevelMap: { low: null, medium: null },
            },
          ),
          { reasoning: "low" },
        );

        expect(payload.temperature).toBe(0.8);
        expect(payload.top_p).toBe(0.95);
        expect(payload.top_k).toBe(64);
      }),
    ));

  it("applies off sampling params when reasoning is disabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* captureSimplePayload(
          makeModel("openai-completions", undefined, {
            samplingParamsByThinkingLevel: { off: { temperature: 0.7 } },
          }),
        );

        expect(payload.temperature).toBe(0.7);
      }),
    ));
});

describe("sampling params", () => {
  it("merges stream-option keys over thinking-level keys", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* captureSimplePayload(
          makeModel("openai-completions", undefined, {
            reasoning: true,
            samplingParamsByThinkingLevel: { low: { temperature: 0.6, top_p: 0.95 } },
          }),
          { reasoning: "low", samplingParams: { top_p: 0.5 } },
        );

        expect(payload.temperature).toBe(0.6);
        expect(payload.top_p).toBe(0.5);
      }),
    ));
});

describe("sampling params", () => {
  it.each(["openai-completions", "openai-responses"] as const)(
    "applies thinking-level params between model and request params for %s",
    (api) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const payload = yield* capturePayload(
            makeModel(
              api,
              { temperature: 1, top_p: 0.95 },
              {
                reasoning: true,
                samplingParamsByThinkingLevel: { low: { temperature: 0.6, top_k: 64 } },
              },
            ),
            { reasoningEffort: "low", samplingParams: { top_p: 0.5 } },
          );

          expect(payload.temperature).toBe(0.6);
          expect(payload.top_p).toBe(0.5);
          expect(payload.top_k).toBe(64);
        }),
      ),
  );

  it.each(["openai-responses"] as const)(
    "uses medium sampling params for summary-only %s requests",
    (api) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const payload = yield* capturePayload(
            makeModel(api, undefined, {
              reasoning: true,
              samplingParamsByThinkingLevel: {
                medium: { temperature: 0.8 },
                off: { temperature: 0.7 },
              },
            }),
            { reasoningSummary: "auto" },
          );

          expect(payload.reasoning?.effort).toBe("medium");
          expect(payload.temperature).toBe(0.8);
        }),
      ),
  );
});

describe("sampling params", () => {
  it("overrides named request fields", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeModel("openai-completions"), {
          samplingParams: { temperature: 1 },
          temperature: 0,
        });

        expect(payload.temperature).toBe(1);
      }),
    ));

  it("is ignored by non-OpenAI-compatible APIs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeModel("anthropic-messages"), {
          samplingParams: { top_k: 40, top_p: 0.9 },
        });

        expect(payload.top_p).toBeUndefined();
        expect(payload.top_k).toBeUndefined();
      }),
    ));
});
