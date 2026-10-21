import { Effect, Stream } from "effect";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiResponsesStream from "../src/api/openai-responses-stream.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import eventStream from "../src/utils/event-stream.ts";

const { currentTimeMillis } = clock;
const { AssistantMessageEventStream } = eventStream;
const { processResponsesStream } = openaiResponsesStream;

function createOutput(model: typesModule.Model<"openai-responses">): typesModule.AssistantMessage {
  return {
    api: model.api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "pending",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

function createFunctionCallEvents(argumentsJson: string): AsyncIterable<ResponseStreamEvent> {
  return Stream.toAsyncIterable(
    Stream.fromIterable(
      (function* () {
        yield {
          item: {
            arguments: "",
            call_id: "call_test",
            id: "fc_test",
            name: "edit",
            type: "function_call",
          },
          type: "response.output_item.added",
        } as ResponseStreamEvent;
        yield {
          delta: '{"path":"README.md"',
          type: "response.function_call_arguments.delta",
        } as ResponseStreamEvent;
        yield {
          delta: ',"content":"updated"}',
          type: "response.function_call_arguments.delta",
        } as ResponseStreamEvent;
        yield {
          arguments: argumentsJson,
          type: "response.function_call_arguments.done",
        } as ResponseStreamEvent;
        yield {
          item: {
            arguments: argumentsJson,
            call_id: "call_test",
            id: "fc_test",
            name: "edit",
            type: "function_call",
          },
          type: "response.output_item.done",
        } as ResponseStreamEvent;
        yield {
          response: { id: "resp_test", status: "completed" },
          sequence_number: 5,
          type: "response.completed",
        } as ResponseStreamEvent;
      })(),
    ),
  );
}

describe("openai responses partialJson cleanup", () => {
  it("removes partialJson from persisted tool-call blocks at output_item.done", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model: typesModule.Model<"openai-responses"> = {
          api: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
          contextWindow: 400000,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
          id: "gpt-5-mini",
          input: ["text"],
          maxTokens: 128000,
          name: "GPT-5 Mini",
          provider: "openai",
          reasoning: true,
        };
        const output = createOutput(model);
        const stream = new AssistantMessageEventStream();
        const pushSpy = vi.spyOn(stream, "push");
        const argumentsJson = '{"path":"README.md","content":"updated"}';

        yield* processResponsesStream(
          createFunctionCallEvents(argumentsJson),
          output,
          stream,
          model,
        );

        expect(output.content).toHaveLength(1);
        const persistedToolCall = output.content[0];
        expect(persistedToolCall?.type).toBe("toolCall");
        if (persistedToolCall === undefined || persistedToolCall.type !== "toolCall") {
          throw new Error("Expected toolCall block");
        }
        expect(persistedToolCall.arguments).toEqual({ content: "updated", path: "README.md" });
        expect("partialJson" in persistedToolCall).toBe(false);

        const emittedEvents = pushSpy.mock.calls.map(
          ([event]) => event as typesModule.AssistantMessageEvent,
        );
        const toolCallEnd = emittedEvents.find((event) => event.type === "toolcall_end");
        expect(toolCallEnd).toBeDefined();
        if (toolCallEnd === undefined || toolCallEnd.type !== "toolcall_end") {
          throw new Error("Expected toolcall_end event");
        }
        expect(toolCallEnd.toolCall).toBe(persistedToolCall);
        expect("partialJson" in toolCallEnd.toolCall).toBe(false);
      }),
    ));
});

describe("openai responses partialJson cleanup", () => {
  it("marks malformed final arguments instead of keeping the parsed prefix", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model: typesModule.Model<"openai-responses"> = {
          api: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
          contextWindow: 400000,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
          id: "gpt-5-mini",
          input: ["text"],
          maxTokens: 128000,
          name: "GPT-5 Mini",
          provider: "openai",
          reasoning: true,
        };
        const output = createOutput(model);
        const stream = new AssistantMessageEventStream();
        const argumentsJson = '{"path":"README.md","content":"updated","mode":.5}';

        yield* processResponsesStream(
          createFunctionCallEvents(argumentsJson),
          output,
          stream,
          model,
        );

        const toolCall = output.content[0];
        if (toolCall === undefined || toolCall.type !== "toolCall")
          throw new Error("Expected toolCall block");
        expect(toolCall.arguments).toEqual({});
        expect(toolCall.argumentsError?.endsWith(`Received arguments:\n${argumentsJson}`)).toBe(
          true,
        );
      }),
    ));
});
