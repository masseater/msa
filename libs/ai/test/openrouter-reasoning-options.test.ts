import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import getOpenRouterThinkingLevelMap from "../scripts/openrouter-reasoning-options.ts";
import { streamSimple } from "../src/api/openai-completions.ts";
import type { Model, ThinkingLevelMap } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const context = normalizeContext({
  messages: [{ content: "Hello", role: "user", timestamp: 0 }],
});

function openRouterModel(thinkingLevelMap?: ThinkingLevelMap): Model<"openai-completions"> {
  return {
    api: "openai-completions",
    baseUrl: "https://example.invalid/v1",
    compat: { thinkingFormat: "openrouter" },
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "stealth/ox-alpha",
    input: ["text"],
    maxTokens: 4096,
    name: "Ox Alpha",
    provider: "openrouter",
    reasoning: true,
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
  };
}

const capturePayload = Effect.fn("capturePayload")(function* (
  model: Model<"openai-completions">,
  reasoning?: "low",
) {
  let payload: { reasoning?: { effort?: string } } | undefined;
  yield* Effect.promise(() =>
    streamSimple(model, context, {
      apiKey: "test",
      onPayload: (request) => {
        payload = request as { reasoning?: { effort?: string } };
        throw new Error("payload captured");
      },
      reasoning,
    }).result(),
  );
  if (payload === undefined) throw new Error("OpenRouter payload was not captured");
  return payload;
});

describe("getOpenRouterThinkingLevelMap", () => {
  it("marks mandatory reasoning and unsupported efforts unavailable", () => {
    expect(
      getOpenRouterThinkingLevelMap({
        default_effort: "max",
        default_enabled: true,
        mandatory: true,
        supported_efforts: ["max", "high", "low"],
      }),
    ).toEqual({
      high: "high",
      low: "low",
      max: "max",
      medium: null,
      minimal: null,
      off: null,
      xhigh: null,
    });
  });

  it("still marks off unavailable when OpenRouter omits effort metadata", () => {
    expect(getOpenRouterThinkingLevelMap({ mandatory: true })).toEqual({ off: null });
  });

  it("keeps off available while restricting optional models to supported efforts", () => {
    expect(
      getOpenRouterThinkingLevelMap({
        default_enabled: true,
        mandatory: false,
        supported_efforts: ["high", "low"],
      }),
    ).toEqual({
      high: "high",
      low: "low",
      max: null,
      medium: null,
      minimal: null,
      off: "none",
      xhigh: null,
    });
  });

  it("does not add metadata for optional models without effort controls", () => {
    expect(getOpenRouterThinkingLevelMap({ mandatory: false })).toBeUndefined();
  });
});

describe("OpenRouter mandatory reasoning payloads", () => {
  const mandatoryMap = getOpenRouterThinkingLevelMap({
    mandatory: true,
    supported_efforts: ["max", "high", "low"],
  });

  it("omits reasoning when a background call does not request it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* capturePayload(openRouterModel(mandatoryMap))).not.toHaveProperty(
          "reasoning",
        );
      }),
    ));

  it("still sends an explicitly selected supported effort", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* capturePayload(openRouterModel(mandatoryMap), "low")).toMatchObject({
          reasoning: { effort: "low" },
        });
      }),
    ));

  it("continues to explicitly disable reasoning for optional models", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* capturePayload(openRouterModel())).toMatchObject({
          reasoning: { effort: "none" },
        });
      }),
    ));
});
