import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { transformMessages } from "../src/api/transform-messages.ts";
import { normalizeContext } from "../src/compat.ts";
import type { Api, Model } from "../src/types.ts";
import anthropicSseParsingSupport from "./anthropic-sse-parsing-support.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel, usesApi } = modelChoice;

const {
  createFakeAnthropicClient,
  createResponseModelSseResponse,
  createSseResponse,
  minimalAnthropicEvents,
} = anthropicSseParsingSupport;
const forwardsParsedProviderStreamEventsIn = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const effectContext = yield* Effect.context();
      const model = chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages"));
      const providerEvents: unknown[] = [];
      const eventModels: Model<Api>[] = [];
      const result = yield* Effect.promise(() =>
        streamAnthropic(
          model,
          normalizeContext({ messages: [{ content: "Hello", role: "user", timestamp: 1 }] }),
          {
            client: createFakeAnthropicClient(createSseResponse(minimalAnthropicEvents)),
            onProviderStreamEvent: (event, eventModel) =>
              Effect.runPromiseWith(effectContext)(
                Effect.gen(function* () {
                  yield* Effect.promise(() => Promise.resolve());
                  providerEvents.push(event);
                  eventModels.push(eventModel);
                }),
              ),
          },
        ).result(),
      );

      expect(result.stopReason).toBe("stop");
      expect(providerEvents.map((event) => (event as { type: string }).type)).toEqual([
        "message_start",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
      ]);
      expect(eventModels).toEqual([model, model, model, model, model, model]);
    }),
  );

const keepsSignedThinkingReplayableWhenA = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages"));
      const responseModel = "kimi-for-coding";
      const initialContext = normalizeContext({
        messages: [{ content: "Hello", role: "user", timestamp: 1 }],
      });
      const first = yield* Effect.promise(() =>
        streamAnthropic(model, initialContext, {
          client: createFakeAnthropicClient(
            createResponseModelSseResponse(responseModel, {
              signature: "signature",
              thinking: "reasoning",
              type: "thinking",
            }),
          ),
        }).result(),
      );

      expect(first.model).toBe(model.id);
      expect(first.responseModel).toBe(responseModel);

      const transformed = transformMessages([...initialContext.messages, first], model);
      const replayedAssistant = transformed.find((message) => message.role === "assistant");
      expect(replayedAssistant?.content).toEqual([
        { thinking: "reasoning", thinkingSignature: "signature", type: "thinking" },
      ]);
    }),
  );

describe("Anthropic raw SSE parsing", () => {
  it("forwards parsed provider stream events in order", forwardsParsedProviderStreamEventsIn);
});

describe("Anthropic raw SSE parsing", () => {
  it(
    "keeps signed thinking replayable when a proxy relabels the model",
    keepsSignedThinkingReplayableWhenA,
  );
});
