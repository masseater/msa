import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { getModel, streamSimple } from "../src/compat.ts";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";
import { getSupportedThinkingLevels } from "../src/models.ts";
import { envValue } from "./env.ts";

const originalBasetenApiKey = envValue("BASETEN_API_KEY");

afterEach(() => {
  if (originalBasetenApiKey === undefined) {
    vi.stubEnv("BASETEN_API_KEY", undefined);
  } else {
    vi.stubEnv("BASETEN_API_KEY", originalBasetenApiKey);
  }
});

describe("Baseten models", () => {
  it("keeps both GLM 5.2 endpoints text-only", () => {
    expect(getModel("baseten", "zai-org/GLM-5.2").input).toEqual(["text"]);
    expect(getModel("baseten", "zai-org/GLM-5.2-Fast").input).toEqual(["text"]);
  });

  it("models Kimi K2.6 reasoning as an explicit off/on toggle", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("baseten", "moonshotai/Kimi-K2.6");
        let payload: Record<string, unknown> | undefined;

        expect(model.thinkingLevelMap).toEqual({
          off: "off",
          minimal: null,
          low: null,
          medium: null,
          high: "high",
          xhigh: null,
          max: null,
        });
        expect(model.compat).toMatchObject({
          supportsReasoningEffort: false,
          thinkingFormat: "baseten",
          chatTemplateArgs: { enable_thinking: { $var: "thinking.enabled" } },
        });
        expect(getSupportedThinkingLevels(model)).toEqual(["off", "high"]);

        yield* Effect.promise(() =>
          streamSimple(
            model,
            { messages: [{ role: "user", content: "test", timestamp: 0 }] },
            {
              apiKey: "test-baseten-key",
              reasoning: "high",
              onPayload: (value) => {
                payload = value as Record<string, unknown>;
                throw new Error("payload captured");
              },
            },
          ).result(),
        );

        expect(payload?.["chat_template_args"]).toEqual({ enable_thinking: true });
        expect(payload?.["reasoning_effort"]).toBeUndefined();
      }),
    ));

  it("sends Baseten chat_template_args with reasoning effort", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("baseten", "zai-org/GLM-5.2");
        let payload: Record<string, unknown> | undefined;

        yield* Effect.promise(() =>
          streamSimple(
            model,
            { messages: [{ role: "user", content: "test", timestamp: 0 }] },
            {
              apiKey: "test-baseten-key",
              reasoning: "high",
              onPayload: (value) => {
                payload = value as Record<string, unknown>;
                throw new Error("payload captured");
              },
            },
          ).result(),
        );

        expect(payload?.["chat_template_args"]).toEqual({ enable_thinking: true });
        expect(payload?.["reasoning_effort"]).toBe("high");
      }),
    ));

  it("disables Baseten opt-in reasoning when thinking is off", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("baseten", "zai-org/GLM-5.2");
        let payload: Record<string, unknown> | undefined;

        yield* Effect.promise(() =>
          streamSimple(
            model,
            { messages: [{ role: "user", content: "test", timestamp: 0 }] },
            {
              apiKey: "test-baseten-key",
              onPayload: (value) => {
                payload = value as Record<string, unknown>;
                throw new Error("payload captured");
              },
            },
          ).result(),
        );

        expect(payload?.["chat_template_args"]).toEqual({ enable_thinking: false });
        expect(payload?.["reasoning_effort"]).toBe("none");
      }),
    ));

  it("resolves BASETEN_API_KEY from the environment", () => {
    vi.stubEnv("BASETEN_API_KEY", "test-baseten-key");

    expect(findEnvKeys("baseten")).toEqual(["BASETEN_API_KEY"]);
    expect(getEnvApiKey("baseten")).toBe("test-baseten-key");
  });
});
