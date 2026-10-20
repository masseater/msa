import type { GenerateContentParameters } from "@google/genai";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import googleGenerativeAi from "../src/api/google-generative-ai.ts";
import googleThinking from "../src/api/google-thinking.ts";
import type typesModule from "../src/types.types.ts";
import transcript from "../src/utils/transcript.ts";

const { normalizeContext } = transcript;
const { streamSimple: streamSimpleGoogle } = googleGenerativeAi;
const { resolveGoogleThinkingLevel } = googleThinking;

const context = normalizeContext({
  messages: [{ content: "Hello", role: "user", timestamp: 0 }],
});

function googleModel(
  id: string,
  thinkingLevelMap: typesModule.ThinkingLevelMap,
): typesModule.Model<"google-generative-ai"> {
  return {
    api: "google-generative-ai",
    baseUrl: "https://example.invalid/v1beta",
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 4096,
    name: id,
    provider: "test-google",
    reasoning: true,
    thinkingLevelMap,
  };
}

function captureGooglePayload(
  model: typesModule.Model<"google-generative-ai">,
  reasoning?: typesModule.ThinkingLevel,
  thinkingBudgets?: typesModule.ThinkingBudgets,
): Promise<GenerateContentParameters> {
  return Effect.runPromise(
    Effect.gen(function* () {
      let payload: GenerateContentParameters | undefined;
      const result = yield* Effect.promise(() =>
        streamSimpleGoogle(model, context, {
          apiKey: "test",
          onPayload: (request) => {
            payload = request as GenerateContentParameters;
            throw new Error("payload captured");
          },
          reasoning,
          thinkingBudgets,
        }).result(),
      );

      expect(result.errorMessage).toContain("payload captured");
      if (payload === undefined) throw new Error("Google payload was not captured");
      return payload;
    }),
  );
}

const googleAdapters = [
  {
    capture: (
      id: string,
      thinkingLevelMap: typesModule.ThinkingLevelMap,
      reasoning?: typesModule.ThinkingLevel,
    ) => captureGooglePayload(googleModel(id, thinkingLevelMap), reasoning),
    name: "Google Generative AI",
  },
] as const;

describe("Google thinking level maps", () => {
  it("exhaustively resolves supported logical levels and mapping values", () => {
    const defaultExpectations = {
      high: "high",
      low: "low",
      medium: "medium",
      minimal: "minimal",
    } as const satisfies Partial<Record<typesModule.ThinkingLevel, typesModule.ThinkingLevel>>;
    for (const [level, expected] of Object.entries(defaultExpectations)) {
      expect(
        resolveGoogleThinkingLevel(
          googleModel("gemini-3.7-flash", {}),
          level as typesModule.ThinkingLevel,
        ),
      ).toBe(expected);
    }

    const mappedExpectations = {
      HIGH: "high",
      LOW: "low",
      MEDIUM: "medium",
      MINIMAL: "minimal",
      high: "high",
      low: "low",
      medium: "medium",
      minimal: "minimal",
    } as const;
    for (const [mapped, expected] of Object.entries(mappedExpectations)) {
      const model = googleModel("gemini-3.7-flash", { high: mapped, max: mapped, xhigh: mapped });
      expect(resolveGoogleThinkingLevel(model, "high")).toBe(expected);
      expect(resolveGoogleThinkingLevel(model, "xhigh")).toBe(expected);
      expect(resolveGoogleThinkingLevel(model, "max")).toBe(expected);
    }

    const invalidModel = googleModel("gemini-3.7-flash", { xhigh: "extreme" });
    expect(() => resolveGoogleThinkingLevel(invalidModel, "xhigh")).toThrow(
      "Unsupported Google thinking level mapping for test-google/gemini-3.7-flash: xhigh -> extreme",
    );
    expect(() => resolveGoogleThinkingLevel(googleModel("gemini-3.7-flash", {}), "max")).toThrow(
      "Unsupported Google thinking level mapping for test-google/gemini-3.7-flash: max -> undefined",
    );
  });
});

describe("Google thinking level maps", () => {
  it.each(googleAdapters)(
    "uses the lowest supported $name level when reasoning is omitted",
    ({ capture }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const payload = yield* Effect.promise(() =>
            capture("gemini-3.8-flash", {
              high: "high",
              low: "low",
              max: null,
              medium: "medium",
              minimal: null,
              off: null,
              xhigh: null,
            }),
          );

          expect(payload.config?.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
        }),
      ),
  );
});

describe("Google thinking level maps", () => {
  it.each(googleAdapters)(
    "preserves native medium effort for Gemini 3.1 Pro on $name",
    ({ capture }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const payload = yield* Effect.promise(() =>
            capture(
              "gemini-3.1-pro-preview",
              {
                high: "high",
                low: "low",
                max: null,
                medium: "medium",
                minimal: null,
                off: null,
                xhigh: null,
              },
              "medium",
            ),
          );

          expect(payload.config?.thinkingConfig).toEqual({
            includeThoughts: true,
            thinkingLevel: "MEDIUM",
          });
        }),
      ),
  );

  it.each(googleAdapters)(
    "disables Gemini 2.5 thinking when reasoning is omitted on $name",
    ({ capture }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const payload = yield* Effect.promise(() => capture("gemini-2.5-flash", {}));

          expect(payload.config?.thinkingConfig).toEqual({ thinkingBudget: 0 });
        }),
      ),
  );
});

describe("Google thinking level maps", () => {
  it.each(googleAdapters)("uses thinking levels for Gemini 4 models on $name", ({ capture }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* Effect.promise(() => capture("gemini-4-argon", {}, "medium"));

        expect(payload.config?.thinkingConfig).toEqual({
          includeThoughts: true,
          thinkingLevel: "MEDIUM",
        });
      }),
    ),
  );

  it.each(["xhigh", "max"] as const)(
    "maps Google Generative AI %s to a supported level",
    (reasoning) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const payload = yield* Effect.promise(() =>
            captureGooglePayload(
              googleModel("gemini-3.7-flash", { max: "high", xhigh: "high" }),
              reasoning,
            ),
          );

          expect(payload).toMatchObject({
            config: { thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" } },
          });
        }),
      ),
  );

  it("honors uppercase provider values for standard Google Generative AI levels", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* Effect.promise(() =>
          captureGooglePayload(googleModel("gemini-3.7-flash", { high: "LOW" }), "high"),
        );

        expect(payload).toMatchObject({ config: { thinkingConfig: { thinkingLevel: "LOW" } } });
      }),
    ));
});

describe("Google thinking level maps", () => {
  it("uses mapped Google Generative AI levels for token budgets", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* Effect.promise(() =>
          captureGooglePayload(googleModel("gemini-2.5-flash", { xhigh: "high" }), "xhigh", {
            high: 1234,
          }),
        );

        expect(payload).toMatchObject({ config: { thinkingConfig: { thinkingBudget: 1234 } } });
      }),
    ));
});
