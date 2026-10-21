import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type openaiResponsesConfigTypes from "../src/api/openai-responses-config.types.ts";
import openaiResponses from "../src/api/openai-responses.ts";
import type typesModule from "../src/types.types.ts";
import transcript from "../src/utils/transcript.ts";

const { stream: streamOpenAIResponses } = openaiResponses;
const { normalizeContext } = transcript;

interface Payload {
  input: Array<Record<string, unknown>>;
  reasoning?: { effort?: string };
}

const thinkingLevelMap = {
  high: "high",
  low: "low",
  max: "max",
  medium: "medium",
  minimal: null,
  off: "none",
  xhigh: "xhigh",
} as const;

function openAIModel(
  compat: typesModule.Model<"openai-responses">["compat"] = { supportsMidConvoEffort: true },
) {
  return {
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    compat,
    contextWindow: 272000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "gpt-6-luna",
    input: ["text"],
    maxTokens: 128000,
    name: "GPT-6 Luna",
    provider: "openai",
    reasoning: true,
    thinkingLevelMap,
  } satisfies typesModule.Model<"openai-responses">;
}

const user = (text: string): typesModule.Message => ({ content: text, role: "user", timestamp: 0 });

const toolResult = (callId: string): typesModule.ToolResultMessage => ({
  content: [{ text: "result", type: "text" }],
  isError: false,
  role: "toolResult",
  timestamp: 0,
  toolCallId: callId,
  toolName: "lookup",
});

const update = (effort: string) => ({ reasoning: { effort }, type: "configuration_update" });

function responseEvents(responseId: string, withToolCall: boolean): object[] {
  const item = withToolCall
    ? {
        arguments: "{}",
        call_id: "call_1",
        id: "fc_1",
        name: "lookup",
        status: "completed",
        type: "function_call",
      }
    : {
        content: [{ annotations: [], text: "answer", type: "output_text" }],
        id: `msg_${responseId}`,
        role: "assistant",
        status: "completed",
        type: "message",
      };
  return [
    { response: { id: responseId }, type: "response.created" },
    { item, output_index: 0, type: "response.output_item.added" },
    { item, output_index: 0, type: "response.output_item.done" },
    { response: { id: responseId, status: "completed" }, type: "response.completed" },
  ];
}

const runOpenAI = Effect.fn("runOpenAI")(function* (
  messages: typesModule.Message[],
  reasoningEffort: openaiResponsesConfigTypes.OpenAIResponsesOptions["reasoningEffort"],
  options: {
    apiKey?: string;
    model?: typesModule.Model<"openai-responses">;
    withToolCall?: boolean;
  } = {},
) {
  const payload: { value: Payload | undefined } = { value: undefined };
  const fetchMock = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    payload.value = JSON.parse(String(init?.body)) as Payload;
    const body = responseEvents("resp_1", options.withToolCall ?? false)
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");
    return Promise.resolve(
      new Response(body, { headers: { "content-type": "text/event-stream" }, status: 200 }),
    );
  };
  const message = yield* Effect.promise(() =>
    streamOpenAIResponses(options.model ?? openAIModel(), normalizeContext({ messages }), {
      apiKey: options.apiKey ?? "sk-test",
      fetch: fetchMock as typeof globalThis.fetch,
      reasoningEffort,
    }).result(),
  );
  if (payload.value === undefined) throw new Error("Request payload was not captured");
  expect(message.stopReason).not.toBe("error");
  return { message, payload: payload.value };
});

const keepsReasoningEffortConstantAndOnly = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const history: typesModule.Message[] = [user("one")];
      const first = yield* runOpenAI(history, "high");
      history.push(first.message, user("two"));
      const second = yield* runOpenAI(history, "high");
      history.push(second.message, user("three"));
      const third = yield* runOpenAI(history, "low");

      expect(first.payload.input).toEqual([
        { content: [{ text: "one", type: "input_text" }], role: "user" },
        update("high"),
      ]);
      for (const { payload } of [first, second, third]) {
        expect(payload.reasoning?.effort).toBe("medium");
      }
      expect(second.payload.input.slice(0, first.payload.input.length)).toEqual(
        first.payload.input,
      );
      expect(third.payload.input.slice(0, second.payload.input.length)).toEqual(
        second.payload.input,
      );
      expect(third.payload.input.filter((item) => item["type"] === "configuration_update")).toEqual(
        [update("high"), update("high"), update("low")],
      );
      expect(third.payload.input.at(-1)).toEqual(update("low"));
      expect([first, second, third].map(({ message }) => message.providerThinkingLevel)).toEqual([
        "high",
        "high",
        "low",
      ]);
    }),
  );

describe("OpenAI Responses configuration_update", () => {
  it(
    "keeps reasoning.effort constant and only appends input when the level changes",
    keepsReasoningEffortConstantAndOnly,
  );
});

const appliesALevelChangeMadeDuring = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const history: typesModule.Message[] = [user("one")];
      const toolCall = yield* runOpenAI(history, "high", { withToolCall: true });
      history.push(toolCall.message, toolResult("call_1|fc_1"));
      const afterTool = yield* runOpenAI(history, "low");

      expect(afterTool.payload.input.slice(0, toolCall.payload.input.length)).toEqual(
        toolCall.payload.input,
      );
      expect(afterTool.payload.input.slice(-2)).toEqual([
        expect.objectContaining({ call_id: "call_1", type: "function_call_output" }),
        update("low"),
      ]);
      expect(afterTool.message.providerThinkingLevel).toBe("low");
    }),
  );

describe("OpenAI Responses configuration_update", () => {
  it(
    "applies a level change made during a tool loop to the next reply",
    appliesALevelChangeMadeDuring,
  );
});

const addsItemsOnlyBeforeRepliesRecordedData = [
  "user",
  "message",
  "user",
  "message",
  "user",
  "message",
  "user",
  "configuration_update",
  "message",
  "user",
  "configuration_update",
];

const addsItemsOnlyBeforeRepliesRecorded = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unstamped = (yield* runOpenAI([user("one")], "high", { model: openAIModel({}) }))
        .message;
      const otherProvider: typesModule.AssistantMessage = {
        ...unstamped,
        provider: "opencode",
        providerThinkingLevel: "high",
      };
      const otherModel: typesModule.AssistantMessage = {
        ...unstamped,
        model: "gpt-6-sol",
        providerThinkingLevel: "high",
      };
      const recorded: typesModule.AssistantMessage = {
        ...unstamped,
        providerThinkingLevel: "high",
      };

      const { payload } = yield* runOpenAI(
        [
          user("one"),
          unstamped,
          user("two"),
          otherProvider,
          user("three"),
          otherModel,
          user("four"),
          recorded,
          user("five"),
        ],
        "low",
      );

      expect(payload.input.map((item) => item["type"] ?? item["role"])).toEqual(
        addsItemsOnlyBeforeRepliesRecordedData,
      );
      expect(payload.input.filter((item) => item["type"] === "configuration_update")).toEqual([
        update("high"),
        update("low"),
      ]);
    }),
  );

describe("OpenAI Responses configuration_update", () => {
  it("adds items only before replies recorded by this model", addsItemsOnlyBeforeRepliesRecorded);
});

describe("OpenAI Responses configuration_update", () => {
  it.each([
    {
      apiKey: "chatgpt-access-token",
      effort: "low",
      level: "low",
      model: openAIModel(),
      name: "Sign in with ChatGPT",
    },
    {
      apiKey: "sk-test",
      effort: "low",
      level: "low",
      model: openAIModel({ supportsMidConvoEffort: false }),
      name: "the compat flag turned off",
    },
    {
      apiKey: "sk-test",
      effort: "none",
      level: undefined,
      model: openAIModel(),
      name: "thinking off",
    },
  ] as const)(
    "sends the level as reasoning.effort with $name",
    ({ apiKey, model, level, effort }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const first = yield* runOpenAI([user("one")], "high", { apiKey, model });
          const { payload, message } = yield* runOpenAI(
            [user("one"), first.message, user("two")],
            level,
            {
              apiKey,
              model,
            },
          );

          expect(payload.reasoning?.effort).toBe(effort);
          expect(payload.input.some((item) => item["type"] === "configuration_update")).toBe(false);
          expect(message.providerThinkingLevel).toBeUndefined();
        }),
      ),
  );
});
