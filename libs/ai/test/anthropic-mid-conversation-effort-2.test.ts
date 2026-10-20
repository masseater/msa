import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream } from "../src/api/anthropic-messages.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import anthropicMidConversationEffortSupport from "./anthropic-mid-conversation-effort-support.ts";

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

describe("Anthropic mid-conversation effort", () => {
  it("generates exact model and transport gates", () => {
    const direct = getModel("anthropic-api", "claude-fable-5-1");
    const openRouter = getModel("openrouter", "anthropic/claude-fable-5.1");
    const unsupported = getModel("anthropic-api", "claude-opus-4-8");
    expect(direct.compat?.supportsMidConvoEffort).toBe(true);
    expect(direct.thinkingLevelMap?.off).toBeNull();
    expect(openRouter.api).toBe("anthropic-messages");
    expect(openRouter.baseUrl).toBe("https://openrouter.ai/api");
    expect(openRouter.compat?.supportsMidConvoEffort).toBe(true);
    expect(unsupported.compat?.supportsMidConvoEffort).toBeUndefined();
    expect(
      getModel("openrouter", "anthropic/claude-opus-5").compat?.supportsMidConvoEffort,
    ).toBeUndefined();
    expect(
      getModel("anthropic-api", "claude-opus-5").compat?.allowedFallbackModels,
    ).toBeUndefined();
  });

  it("supports off only on managed models that accept disabled thinking", () => {
    for (const id of ["claude-opus-5", "claude-haiku-5-5"] as const) {
      const model = getModel("anthropic-api", id);
      expect(model.compat?.supportsMidConvoEffort).toBe(true);
      expect(model.thinkingLevelMap?.off).not.toBeNull();
    }
    for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"] as const) {
      expect(getModel("anthropic-api", id).thinkingLevelMap?.off).toBeNull();
    }
  });
});
