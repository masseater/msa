import { Effect, Stream } from "effect";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vite-plus/test";

import { convertResponsesMessages } from "../src/api/openai-responses-messages.ts";
import { processResponsesStream } from "../src/api/openai-responses-stream.ts";
import type { Api, AssistantMessage, Model, ToolCall } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const model: Model<"openai-responses"> = {
  api: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
  contextWindow: 400000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "gpt-5.4",
  input: ["text"],
  maxTokens: 128000,
  name: "GPT-5.4",
  provider: "openai",
  reasoning: true,
};

function createOutput(): AssistantMessage {
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

function createFunctionCallEvents(): AsyncIterable<ResponseStreamEvent> {
  return Stream.toAsyncIterable(
    Stream.fromIterable(
      (function* () {
        yield {
          item: {
            arguments: "",
            call_id: "call_test",
            id: "fc_test",
            name: "lookup",
            type: "function_call",
          },
          output_index: 0,
          sequence_number: 0,
          type: "response.output_item.added",
        } as ResponseStreamEvent;
        yield {
          item: {
            arguments: '{"value":"hello"}',
            call_id: "call_test",
            id: "fc_test",
            name: "lookup",
            namespace: "dynamic_tools",
            type: "function_call",
          },
          output_index: 0,
          sequence_number: 1,
          type: "response.output_item.done",
        } as ResponseStreamEvent;
        yield {
          response: { id: "resp_test", status: "completed" },
          sequence_number: 2,
          type: "response.completed",
        } as ResponseStreamEvent;
      })(),
    ),
  );
}

function createCustomToolCallEvents(): AsyncIterable<ResponseStreamEvent> {
  return Stream.toAsyncIterable(
    Stream.fromIterable(
      (function* () {
        yield {
          item: {
            call_id: "call_test",
            id: "ctc_test",
            input: "",
            name: "query",
            type: "custom_tool_call",
          },
          output_index: 0,
          sequence_number: 0,
          type: "response.output_item.added",
        } as ResponseStreamEvent;
        yield {
          item: {
            call_id: "call_test",
            id: "ctc_test",
            input: "hello",
            name: "query",
            namespace: "dynamic_tools",
            type: "custom_tool_call",
          },
          output_index: 0,
          sequence_number: 1,
          type: "response.output_item.done",
        } as ResponseStreamEvent;
        yield {
          response: { id: "resp_test", status: "completed" },
          sequence_number: 2,
          type: "response.completed",
        } as ResponseStreamEvent;
      })(),
    ),
  );
}

function getToolCall(output: AssistantMessage): ToolCall {
  const block = output.content[0];
  if (block === undefined || block.type !== "toolCall") throw new Error("Expected toolCall block");
  return block;
}

describe("OpenAI Responses terminal messages", () => {
  it("omits an absent error message", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const output = createOutput();
        yield* processResponsesStream(
          createFunctionCallEvents(),
          output,
          new AssistantMessageEventStream(),
          model,
        );

        expect(output).not.toHaveProperty("errorMessage");
      }),
    ));
});

describe("OpenAI Responses tool-call namespaces", () => {
  it("round-trips a function namespace received only on output_item.done", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const output = createOutput();
        yield* processResponsesStream(
          createFunctionCallEvents(),
          output,
          new AssistantMessageEventStream(),
          model,
        );

        const toolCall = getToolCall(output);
        expect(toolCall).toMatchObject({
          arguments: { value: "hello" },
          id: "call_test|fc_test",
          name: "lookup",
          namespace: "dynamic_tools",
        });

        const replayed = convertResponsesMessages(
          model,
          normalizeContext({ messages: [output] }),
          new Set(["openai"]),
        ).find((item) => item.type === "function_call");
        expect(replayed).toMatchObject({
          arguments: '{"value":"hello"}',
          call_id: "call_test",
          id: "fc_test",
          name: "lookup",
          namespace: "dynamic_tools",
          type: "function_call",
        });
      }),
    ));
});

describe("OpenAI Responses tool-call namespaces", () => {
  it("round-trips a custom-tool namespace received only on output_item.done", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const output = createOutput();
        const grammarToolInputProperties = new Map([["query", "input"]]);
        yield* processResponsesStream(
          createCustomToolCallEvents(),
          output,
          new AssistantMessageEventStream(),
          model,
          {
            grammarToolInputProperties,
          },
        );

        const toolCall = getToolCall(output);
        expect(toolCall).toMatchObject({
          arguments: { input: "hello" },
          id: "call_test|ctc_test",
          name: "query",
          namespace: "dynamic_tools",
        });

        const replayed = convertResponsesMessages(
          model,
          normalizeContext({ messages: [output] }),
          new Set(["openai"]),
          {
            grammarToolInputProperties,
          },
        ).find((item) => item.type === "custom_tool_call");
        expect(replayed).toMatchObject({
          call_id: "call_test",
          id: "ctc_test",
          input: "hello",
          name: "query",
          namespace: "dynamic_tools",
          type: "custom_tool_call",
        });
      }),
    ));
});

describe("OpenAI Responses tool-call namespaces", () => {
  it("drops namespaces when the target cannot replay their load items", () => {
    const output = createOutput();
    output.content.push(
      {
        arguments: { value: "hello" },
        id: "call_function|fc_test",
        name: "lookup",
        namespace: "dynamic_tools",
        type: "toolCall",
      },
      {
        arguments: { input: "hello" },
        id: "call_custom|ctc_test",
        name: "query",
        namespace: "dynamic_tools",
        type: "toolCall",
      },
    );
    const targetModels: Model<Api>[] = [
      { ...model, id: "gpt-5.2", name: "GPT-5.2" },
      { ...model, provider: "opencode" },
      {
        ...model,
        api: "openai-codex-responses",
        id: "gpt-5.3-codex-spark",
        name: "GPT-5.3 Codex Spark",
        provider: "openai-codex",
      },
    ];

    for (const targetModel of targetModels) {
      const replayed = convertResponsesMessages(
        targetModel,
        normalizeContext({ messages: [output] }),
        new Set(["openai"]),
        {
          grammarToolInputProperties: new Map([["query", "input"]]),
        },
      );
      const functionCall = replayed.find((item) => item.type === "function_call");
      const customToolCall = replayed.find((item) => item.type === "custom_tool_call");
      expect(functionCall).toBeDefined();
      expect(functionCall).not.toHaveProperty("namespace");
      expect(customToolCall).toBeDefined();
      expect(customToolCall).not.toHaveProperty("namespace");
    }
  });
});

describe("OpenAI Responses tool-call namespaces", () => {
  it("does not add a namespace to ordinary function calls", () => {
    const output = createOutput();
    output.content.push({
      arguments: { value: "hello" },
      id: "call_test|fc_test",
      name: "lookup",
      type: "toolCall",
    });

    const replayed = convertResponsesMessages(
      model,
      normalizeContext({ messages: [output] }),
      new Set(["openai"]),
    ).find((item) => item.type === "function_call");
    expect(replayed).toBeDefined();
    expect(replayed).not.toHaveProperty("namespace");
  });
});
