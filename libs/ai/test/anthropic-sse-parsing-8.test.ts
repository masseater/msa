import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import anthropicSseParsingSupport from "./anthropic-sse-parsing-support.ts";

const { createFakeAnthropicClient, createSseResponse, minimalAnthropicEvents } =
  anthropicSseParsingSupport;

const treatsMessageDeltaWithoutUsageAs = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = getModel("anthropic-api", "claude-haiku-4-5");
      const context = normalizeContext({
        messages: [
          { content: "Say hello.", role: "user", timestamp: yield* Clock.currentTimeMillis },
        ],
      });
      const response = createSseResponse(
        minimalAnthropicEvents.map((event) =>
          event.event === "message_delta"
            ? {
                data: {
                  delta: { stop_reason: "end_turn" },
                  type: "message_delta",
                },
                event: "message_delta",
              }
            : event,
        ),
      );

      const stream = streamAnthropic(model, context, {
        client: createFakeAnthropicClient(response),
      });
      const result = yield* Effect.promise(() => stream.result());

      expect(result.stopReason).toBe("stop");
      expect(result.errorMessage).toBeUndefined();
      expect(result.content).toEqual([{ text: "Hello", type: "text" }]);
      expect(result.usage.input).toBe(12);
      expect(result.usage.totalTokens).toBe(12);
    }),
  );

const ignoresUnknownSSEEventsAfterMessage = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = getModel("anthropic-api", "claude-haiku-4-5");
      const context = normalizeContext({
        messages: [
          { content: "Say hello.", role: "user", timestamp: yield* Clock.currentTimeMillis },
        ],
      });
      const response = createSseResponse([
        ...minimalAnthropicEvents,
        { data: "[DONE]", event: "done" },
        { data: "not json", event: "proxy.stats" },
      ]);

      const stream = streamAnthropic(model, context, {
        client: createFakeAnthropicClient(response),
      });
      const result = yield* Effect.promise(() => stream.result());

      expect(result.stopReason).toBe("stop");
      expect(result.errorMessage).toBeUndefined();
      expect(result.content).toEqual([{ text: "Hello", type: "text" }]);
    }),
  );

describe("Anthropic raw SSE parsing", () => {
  it(
    "treats message_delta without usage as a no-op for usage accumulation",
    treatsMessageDeltaWithoutUsageAs,
  );
});

describe("Anthropic raw SSE parsing", () => {
  it("ignores unknown SSE events after message_stop", ignoresUnknownSSEEventsAfterMessage);
});
