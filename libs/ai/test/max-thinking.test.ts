import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { streamSimple as streamSimpleOpenAICodexResponses } from "../src/api/openai-codex-responses.ts";
import {
  clampThinkingLevel,
  getModel,
  getSupportedThinkingLevels,
  normalizeContext,
} from "../src/compat.ts";
import type { Model } from "../src/types.ts";

function mockToken(): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
    "utf8",
  ).toString("base64");
  return `aaa.${payload}.bbb`;
}

describe("max thinking level", () => {
  it("is opt-in for ordinary reasoning models", () => {
    const model: Model<"openai-completions"> = {
      api: "openai-completions",
      baseUrl: "https://example.com/v1",
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "ordinary-reasoning",
      input: ["text"],
      maxTokens: 4096,
      name: "Ordinary Reasoning",
      provider: "test",
      reasoning: true,
    };

    expect(getSupportedThinkingLevels(model)).toEqual(["off", "minimal", "low", "medium", "high"]);
    expect(clampThinkingLevel(model, "max")).toBe("high");
  });

  it.each(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-luna", "gpt-6-sol"] as const)(
    "exposes xhigh and max for openai-codex/%s",
    (modelId) => {
      const model = getModel("openai-codex", modelId);
      expect(model).toBeDefined();
      expect(model?.thinkingLevelMap).toMatchObject({ max: "max", xhigh: "xhigh" });
      expect(getSupportedThinkingLevels(model!)).toEqual([
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
    },
  );
});

describe("max thinking level", () => {
  it("supports a hole between high and max", () => {
    const model: Model<"openai-completions"> = {
      api: "openai-completions",
      baseUrl: "https://example.com/v1",
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "high-and-max",
      input: ["text"],
      maxTokens: 4096,
      name: "High and Max",
      provider: "test",
      reasoning: true,
      thinkingLevelMap: { max: "max", xhigh: null },
    };

    expect(getSupportedThinkingLevels(model)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(clampThinkingLevel(model, "xhigh")).toBe("max");
  });
});

describe("max thinking level", () => {
  it.each(["gpt-5.6-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-6.1-sol"] as const)(
    "sends max to the Codex Responses API for %s",
    (modelId) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const model = getModel("openai-codex", modelId)!;
          const context = normalizeContext({
            messages: [
              { content: "Hello", role: "user", timestamp: yield* Clock.currentTimeMillis },
            ],
            systemPrompt: "You are a helpful assistant.",
          });
          let payload: unknown;

          yield* Effect.promise(() =>
            streamSimpleOpenAICodexResponses(model, context, {
              apiKey: mockToken(),
              onPayload: (request) => {
                payload = request;
                throw new Error("payload captured");
              },
              reasoning: "max",
            }).result(),
          );

          expect(payload).toMatchObject({ reasoning: { effort: "max", summary: "auto" } });
        }),
      ),
  );
});
