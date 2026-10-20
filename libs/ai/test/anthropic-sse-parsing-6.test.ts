import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import anthropicMessages from "../src/api/anthropic-messages.ts";
import compat from "../src/compat.ts";
import clock from "../src/utils/clock.ts";
import anthropicSseParsingSupport from "./anthropic-sse-parsing-support.ts";
import modelChoice from "./model-choice.ts";

const { normalizeContext } = compat;
const { currentTimeMillis } = clock;
const { stream: streamAnthropic } = anthropicMessages;

const { createFakeAnthropicClient, createSseResponse, sse } = anthropicSseParsingSupport;
const { chooseModel, usesApi } = modelChoice;

const initialContentResponse = () =>
  createSseResponse([
    sse.messageStart("msg_initial_content"),
    sse.blockStart(0, { text: "Initial text", type: "text" }),
    sse.blockDelta(0, { text: " plus delta", type: "text_delta" }),
    sse.blockStop(0),
    sse.blockStart(1, {
      signature: "initial signature",
      thinking: "Initial thinking",
      type: "thinking",
    }),
    sse.blockDelta(1, { thinking: " plus delta", type: "thinking_delta" }),
    sse.blockDelta(1, { signature: " plus delta", type: "signature_delta" }),
    sse.blockStop(1),
    sse.messageDelta({ stop_reason: "end_turn" }),
    sse.messageStop,
  ]);

const preservesInitialContent = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages"));
      const context = normalizeContext({
        messages: [{ content: "Say hello.", role: "user", timestamp: currentTimeMillis() }],
      });
      const stream = streamAnthropic(model, context, {
        client: createFakeAnthropicClient(initialContentResponse()),
      });
      const result = yield* Effect.promise(() => stream.result());

      expect(result.content).toEqual([
        { text: "Initial text plus delta", type: "text" },
        {
          thinking: "Initial thinking plus delta",
          thinkingSignature: "initial signature plus delta",
          type: "thinking",
        },
      ]);
    }),
  );

describe("Anthropic raw SSE parsing", () => {
  it("preserves content from content_block_start events", preservesInitialContent);
});
