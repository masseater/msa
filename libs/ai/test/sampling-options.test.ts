import { Data, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream, streamSimple } from "../src/compat.ts";
import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
  StreamOptions,
  ThinkingLevel,
} from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

type DirectSamplingOptions = StreamOptions & {
  reasoningEffort?: ThinkingLevel;
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

function makeContext(): Context {
  return {
    messages: [{ role: "user", content: "Hello", timestamp: currentTimeMillis() }],
  };
}

function makeModel(
  api: Api,
  samplingParams?: Record<string, unknown>,
  overrides: Partial<Model<Api>> = {},
): Model<Api> {
  return {
    id: "custom-model",
    name: "Custom Model",
    api,
    provider: "custom-provider",
    baseUrl: "http://127.0.0.1:9/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
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
  model: Model<Api>,
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
  model: Model<Api>,
  options?: SimpleStreamOptions,
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
          samplingParams: { top_p: 0.95, top_k: 0, min_p: 0 },
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

  it.each(["openai-completions", "openai-responses", "azure-openai-responses"] as const)(
    "applies model-level sampling params with request keys taking precedence for %s",
    (api) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const payload = yield* capturePayload(makeModel(api, { top_p: 0.95, min_p: 0.05 }), {
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
              thinkingLevelMap: { low: null, medium: null },
              samplingParamsByThinkingLevel: { high: { temperature: 0.8, top_k: 64 } },
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
  it.each(["openai-completions", "openai-responses", "azure-openai-responses"] as const)(
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

  it.each(["openai-responses", "azure-openai-responses"] as const)(
    "uses medium sampling params for summary-only %s requests",
    (api) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const payload = yield* capturePayload(
            makeModel(api, undefined, {
              reasoning: true,
              samplingParamsByThinkingLevel: {
                off: { temperature: 0.7 },
                medium: { temperature: 0.8 },
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
          temperature: 0,
          samplingParams: { temperature: 1 },
        });

        expect(payload.temperature).toBe(1);
      }),
    ));

  it("is ignored by non-OpenAI-compatible APIs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(makeModel("anthropic-messages"), {
          samplingParams: { top_p: 0.9, top_k: 40 },
        });

        expect(payload.top_p).toBeUndefined();
        expect(payload.top_k).toBeUndefined();
      }),
    ));
});
