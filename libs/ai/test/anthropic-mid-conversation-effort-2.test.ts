import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream } from "../src/api/anthropic-messages.ts";
import { normalizeContext } from "../src/compat.ts";
import anthropicMidConversationEffortSupport from "./anthropic-mid-conversation-effort-support.ts";
import modelChoice from "./model-choice.ts";

const { compatValue, modelsWhere } = modelChoice;

const { capture, managedModel, user } = anthropicMidConversationEffortSupport;
describe("Anthropic mid-conversation effort", () => {
  it("leaves unsupported models on top-level effort", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = managedModel();
        model.compat = { forceAdaptiveThinking: true };
        const { payload, message } = yield* capture(
          model,
          { messages: [user("one", 1)] },
          { effort: "low" },
        );
        expect(payload.messages).toEqual([{ content: "one", role: "user" }]);
        expect(payload.output_config).toEqual({ effort: "low" });
        expect(payload.thinking).toEqual({ display: "summarized", type: "adaptive" });
        expect(message.providerThinkingLevel).toBeUndefined();
      }),
    ));
});

describe("Anthropic mid-conversation effort", () => {
  it("sends the effort and binding beta headers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let betaHeader: string | null = null;
        const events = [
          {
            message: {
              id: "msg_test",
              model: "claude-fable-5-1",
              usage: { input_tokens: 1, output_tokens: 0 },
            },
            type: "message_start",
          },
          {
            delta: { stop_reason: "end_turn" },
            type: "message_delta",
            usage: { input_tokens: 1, output_tokens: 1 },
          },
          { type: "message_stop" },
        ];
        const body = events
          .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          .join("");
        const fetchImpl: typeof fetch = (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init);
          betaHeader = request.headers.get("anthropic-beta");
          return Promise.resolve(
            new Response(body, { headers: { "content-type": "text/event-stream" }, status: 200 }),
          );
        };
        const result = yield* Effect.promise(() =>
          stream(managedModel(), normalizeContext({ messages: [user("one", 1)] }), {
            apiKey: "test-key",
            cacheRetention: "none",
            fetch: fetchImpl,
          }).result(),
        );

        expect(result.stopReason).toBe("stop");
        expect(betaHeader).toContain("mid-conversation-output-config-2026-07-01");
        expect(betaHeader).toContain("thinking-binding-controls-2026-08-01");
      }),
    ));
});

const catalogModels = (["anthropic-api", "openrouter", "opencode"] as const).flatMap((provider) =>
  modelsWhere(provider, () => true),
);
const managedModels = catalogModels.filter(
  (model) => compatValue(model, "supportsMidConvoEffort") === true,
);
const directManagedModels = managedModels.filter((model) => model.provider === "anthropic-api");

describe("Anthropic mid-conversation effort", () => {
  it("gates mid-conversation effort to verified Messages transports", () => {
    expect(new Set(managedModels.map((model) => model.provider))).toEqual(
      new Set(["anthropic-api", "openrouter"]),
    );
    for (const model of managedModels) {
      expect(model.api, model.id).toBe("anthropic-messages");
      if (model.provider === "openrouter") {
        expect(model.baseUrl, model.id).toBe("https://openrouter.ai/api");
      }
    }
  });

  it("only falls back to catalog models at their catalog price", () => {
    const withFallbacks = catalogModels.filter(
      (model) => compatValue(model, "allowedFallbackModels") !== undefined,
    );
    expect(withFallbacks.length).toBeGreaterThan(0);
    for (const model of withFallbacks) {
      const fallbacks = compatValue(model, "allowedFallbackModels") as readonly {
        readonly cost: unknown;
        readonly model: string;
        readonly provider: string;
      }[];
      for (const fallback of fallbacks) {
        const target = catalogModels.find(
          (candidate) =>
            candidate.provider === fallback.provider && candidate.id === fallback.model,
        );
        expect(target, fallback.model).toBeDefined();
        expect(fallback.cost).toEqual(target?.cost);
        if (compatValue(model, "supportsMidConvoEffort") === true) {
          expect(target && compatValue(target, "supportsMidConvoEffort"), fallback.model).toBe(
            true,
          );
        }
      }
    }
  });

  it("keeps managed models on both sides of disabled thinking", () => {
    expect(directManagedModels.some((model) => model.thinkingLevelMap?.off === null)).toBe(true);
    expect(directManagedModels.some((model) => model.thinkingLevelMap?.off !== null)).toBe(true);
  });
});
