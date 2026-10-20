import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { normalizeContext } from "../src/compat.ts";
import anthropicSseParsingSupport from "./anthropic-sse-parsing-support.ts";
import modelChoice from "./model-choice.ts";

const { createFakeAnthropicClient, createSseResponse, minimalAnthropicEvents } =
  anthropicSseParsingSupport;
const { chooseModel, usesApi } = modelChoice;

const droppedThinking = (path: string, reason: string) => [
  { path, reason, type: "thinking_dropped" },
];

const transformationEvents = (modelId: string) => {
  const [, contentStart, contentDelta, contentStop, messageDelta, messageStop] =
    minimalAnthropicEvents;
  return [
    {
      data: {
        message: {
          id: "msg_transformations",
          input_transformations: droppedThinking("messages.1.content.0", "prefix_binding_mismatch"),
          model: modelId,
          usage: { input_tokens: 12, output_tokens: 0 },
        },
        type: "message_start",
      },
      event: "message_start",
    },
    contentStart,
    contentDelta,
    contentStop,
    {
      data: {
        ...messageDelta?.data,
        input_transformations: droppedThinking("messages.3.content.0", "model_binding_mismatch"),
      },
      event: "message_delta",
    },
    messageStop,
  ].filter((event) => event !== undefined);
};

const usesFinalTransformations = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages"));
      const result = yield* Effect.promise(() =>
        streamAnthropic(
          model,
          normalizeContext({ messages: [{ content: "Hello", role: "user", timestamp: 1 }] }),
          { client: createFakeAnthropicClient(createSseResponse(transformationEvents(model.id))) },
        ).result(),
      );
      expect(result.diagnostics).toEqual([
        {
          details: {
            transformations: droppedThinking("messages.3.content.0", "model_binding_mismatch"),
          },
          timestamp: expect.any(Number),
          type: "anthropic_input_transformations",
        },
      ]);
    }),
  );

describe("Anthropic raw SSE parsing", () => {
  it(
    "uses the serving model input transformations from the final stream event",
    usesFinalTransformations,
  );
});
