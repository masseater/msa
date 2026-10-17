import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { getModels, streamSimple } from "../src/compat.ts";
import { getSupportedThinkingLevels } from "../src/models.ts";
import type { ThinkingLevel } from "../src/types.ts";

const XIAOMI_PROVIDERS = [
  "xiaomi",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-sgp",
] as const;
const DEPRECATED_MODEL_IDS = [
  "mimo-v2-flash",
  "mimo-v2-omni",
  "mimo-v2-pro",
  "mimo-v2.5",
  "mimo-v2.5-pro",
] as const;
const REPLACEMENT_MODEL_IDS = ["mimo-v2.6-flash", "mimo-v2.6-pro"] as const;

describe("Xiaomi MiMo models", () => {
  it.each(XIAOMI_PROVIDERS)("omits deprecated models from %s", (provider) => {
    const modelIds = getModels(provider).map((model) => model.id);
    for (const modelId of DEPRECATED_MODEL_IDS) expect(modelIds).not.toContain(modelId);
  });

  it.each(XIAOMI_PROVIDERS)("keeps replacement models on %s", (provider) => {
    const modelIds = getModels(provider).map((model) => model.id);
    for (const modelId of REPLACEMENT_MODEL_IDS) expect(modelIds).toContain(modelId);
  });

  it.each(XIAOMI_PROVIDERS)("models %s reasoning as an off/on toggle", (provider) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const models = getModels(provider).filter((model) => model.reasoning);
        expect(models.length).toBeGreaterThan(0);

        for (const model of models) {
          expect(getSupportedThinkingLevels(model)).toEqual(["off", "high"]);

          const capturePayload = Effect.fn("capturePayload")(function* (
            reasoning: ThinkingLevel | undefined,
          ) {
            let payload: Record<string, unknown> | undefined;
            yield* Effect.promise(() =>
              streamSimple(
                model,
                { messages: [{ role: "user", content: "test", timestamp: 0 }] },
                {
                  apiKey: "test-xiaomi-key",
                  reasoning,
                  onPayload: (value) => {
                    payload = value as Record<string, unknown>;
                    throw new Error("payload captured");
                  },
                },
              ).result(),
            );
            return payload;
          });

          const enabled = yield* capturePayload("high");
          expect(enabled?.["thinking"]).toEqual({ type: "enabled" });
          expect(enabled?.["reasoning_effort"]).toBeUndefined();

          const disabled = yield* capturePayload(undefined);
          expect(disabled?.["thinking"]).toEqual({ type: "disabled" });
          expect(disabled?.["reasoning_effort"]).toBeUndefined();
        }
      }),
    ),
  );
});
