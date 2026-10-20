import { describe, expect, it } from "vite-plus/test";

import constrainedSampling from "../src/api/constrained-sampling.ts";
import openaiResponsesMessages from "../src/api/openai-responses-messages.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import transcript from "../src/utils/transcript.ts";
import constrainedSamplingSupport from "./constrained-sampling-support.ts";

const { convertResponsesMessages } = openaiResponsesMessages;
const { normalizeContext } = transcript;
const { currentTimeMillis } = clock;
const { appendGrammarToolInputJsonDelta } = constrainedSampling;

const { makeModel, makeUsage } = constrainedSamplingSupport;

const replaysGrammarCallsAsCustomResponses = () => {
  const context = replaysGrammarCallsAsCustomResponsesStep1();
  const messages = convertResponsesMessages(makeModel(), context, new Set(["openai"]), {
    grammarToolInputProperties: new Map([["sample_tool", "payload"]]),
  });

  expect(messages).toContainEqual({
    call_id: "call_1",
    id: "ctc_1",
    input: "abc",
    name: "sample_tool",
    type: "custom_tool_call",
  });
  expect(messages).toContainEqual({
    call_id: "call_1",
    output: "done",
    type: "custom_tool_call_output",
  });
};

const dropsForeignItemIdsWhenReplaying = () => {
  const context = normalizeContext({
    messages: [
      {
        api: "openai-completions",
        content: [
          {
            arguments: { payload: "abc" },
            id: "call_1|ctc_1",
            name: "sample_tool",
            type: "toolCall",
          },
        ],
        model: "gpt-other",
        provider: "openrouter",
        role: "assistant",
        stopReason: "toolUse",
        timestamp: currentTimeMillis(),
        usage: makeUsage(),
      },
      {
        content: [{ text: "done", type: "text" }],
        isError: false,
        role: "toolResult",
        timestamp: currentTimeMillis(),
        toolCallId: "call_1|ctc_1",
        toolName: "sample_tool",
      },
    ],
  });

  const messages = convertResponsesMessages(makeModel(), context, new Set(["openai"]), {
    grammarToolInputProperties: new Map([["sample_tool", "payload"]]),
  });

  const call = messages.find((item) => "type" in item && item.type === "custom_tool_call");
  expect(call).toMatchObject({ call_id: "call_1", input: "abc", type: "custom_tool_call" });
  expect(call !== undefined && "id" in call ? call.id : undefined).toBeUndefined();
};

const keepsGrammarInputJSONDeltasAppend = () => {
  const buffer = { closed: false, input: "", started: false };
  const first = appendGrammarToolInputJsonDelta(buffer, "payload", 'a"', false);
  const second = appendGrammarToolInputJsonDelta(buffer, "payload", 'a"\nb', true);

  expect(JSON.parse(`${first}${second}`)).toEqual({ payload: 'a"\nb' });
  expect(appendGrammarToolInputJsonDelta(buffer, "payload", 'a"\nb', true)).toBeUndefined();
  expect(() => appendGrammarToolInputJsonDelta(buffer, "payload", "changed", true)).toThrow(
    'grammar tool input for property "payload" changed after it was closed',
  );
};

function replaysGrammarCallsAsCustomResponsesStep1() {
  const replayedToolCall: typesModule.ToolCall = {
    arguments: { payload: "abc" },
    id: "call_1|ctc_1",
    name: "sample_tool",
    type: "toolCall",
  };
  const context = normalizeContext({
    messages: [
      {
        api: "openai-responses",
        content: [replayedToolCall],
        model: "gpt-test",
        provider: "openai",
        role: "assistant",
        stopReason: "toolUse",
        timestamp: currentTimeMillis(),
        usage: makeUsage(),
      },
      {
        content: [{ text: "done", type: "text" }],
        isError: false,
        role: "toolResult",
        timestamp: currentTimeMillis(),
        toolCallId: "call_1|ctc_1",
        toolName: "sample_tool",
      },
    ],
  });
  const invalidArgumentsList: typesModule.ToolCall["arguments"][] = [{}, { payload: 42 }];
  for (const invalidArguments of invalidArgumentsList) {
    replayedToolCall.arguments = invalidArguments;
    expect(() =>
      convertResponsesMessages(makeModel(), context, new Set(["openai"]), {
        grammarToolInputProperties: new Map([["sample_tool", "payload"]]),
      }),
    ).toThrow('Grammar tool call "sample_tool" requires argument "payload" to be a string');
  }

  replayedToolCall.arguments = { payload: "abc" };
  return context;
}

describe("constrained tool sampling", () => {
  it("replays grammar calls as custom Responses items", replaysGrammarCallsAsCustomResponses);
});

describe("constrained tool sampling", () => {
  it(
    "drops foreign item ids when replaying grammar calls as custom Responses items",
    dropsForeignItemIdsWhenReplaying,
  );
});

describe("constrained tool sampling", () => {
  it("keeps grammar input JSON deltas append-only", keepsGrammarInputJSONDeltasAppend);
});
