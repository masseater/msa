import { Effect } from "effect";
import { Type } from "typebox";
import { expect } from "vite-plus/test";

import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";

const { currentTimeMillis } = clock;
const { complete } = compat;

type StreamOptionsWithExtras = typesModule.StreamOptions & Record<string, unknown>;

interface ToolResultScenario {
  readonly followUp: string;
  readonly request: string;
  readonly resultText: string;
  readonly toolCallId: string;
  readonly toolDescription: string;
  readonly toolName: string;
}

const emptyUsage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

const toolResultContext = <TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  scenario: ToolResultScenario,
): typesModule.Context => ({
  messages: [
    { content: scenario.request, role: "user", timestamp: currentTimeMillis() },
    {
      api: llm.api,
      content: [
        { arguments: {}, id: scenario.toolCallId, name: scenario.toolName, type: "toolCall" },
      ],
      model: llm.id,
      provider: llm.provider,
      role: "assistant",
      stopReason: "toolUse",
      timestamp: currentTimeMillis(),
      usage: emptyUsage,
    },
    {
      content: [{ text: scenario.resultText, type: "text" }],
      isError: false,
      role: "toolResult",
      timestamp: currentTimeMillis(),
      toolCallId: scenario.toolCallId,
      toolName: scenario.toolName,
    },
    { content: scenario.followUp, role: "user", timestamp: currentTimeMillis() },
  ],
  systemPrompt: "You are a helpful assistant.",
  tools: [
    { description: scenario.toolDescription, name: scenario.toolName, parameters: Type.Object({}) },
  ],
});

const answerToolResult = <TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras,
  scenario: ToolResultScenario,
) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      complete(llm, toolResultContext(llm, scenario), options),
    );
    expect(response.stopReason).not.toBe("error");
    expect(response.errorMessage).toBeFalsy();
    return response;
  });

const testEmojiInToolResults = <TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras = {},
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* answerToolResult(llm, options, {
        followUp: "Summarize the tool result briefly.",
        request: "Use the test tool",
        resultText: `Test with emoji 🙈 and other characters:
- Monkey emoji: 🙈
- Thumbs up: 👍
- Heart: ❤️
- Thinking face: 🤔
- Rocket: 🚀
- Mixed text: Mario Zechner wann? Wo? Bin grad äußersr eventuninformiert 🙈
- Japanese: こんにちは
- Chinese: 你好
- Mathematical symbols: ∑∫∂√
- Special quotes: "curly" 'quotes'`,
        toolCallId: "test_1",
        toolDescription: "A test tool",
        toolName: "test_tool",
      });
      expect(response.content.length).toBeGreaterThan(0);
    }),
  );

const testRealWorldLinkedInData = <TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras = {},
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* answerToolResult(llm, options, {
        followUp: "How many comments are there?",
        request: "Use the linkedin tool to get comments",
        resultText: `Post: Hab einen "Generative KI für Nicht-Techniker" Workshop gebaut.
Unanswered Comments: 2

=> {
  "comments": [
    {
      "author": "Matthias Neumayer's  graphic link",
      "text": "Leider nehmen das viel zu wenige Leute ernst"
    },
    {
      "author": "Matthias Neumayer's  graphic link",
      "text": "Mario Zechner wann? Wo? Bin grad äußersr eventuninformiert 🙈"
    }
  ]
}`,
        toolCallId: "linkedin_1",
        toolDescription: "Get LinkedIn comments",
        toolName: "linkedin_skill",
      });
      expect(response.content.some((block) => block.type === "text")).toBe(true);
    }),
  );

const testUnpairedHighSurrogate = <TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras = {},
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const unpairedSurrogate = String.fromCharCode(0xd83d);
      const response = yield* answerToolResult(llm, options, {
        followUp: "What did the tool return?",
        request: "Use the test tool",
        resultText: `Text with unpaired surrogate: ${unpairedSurrogate} <- should be sanitized`,
        toolCallId: "test_2",
        toolDescription: "A test tool",
        toolName: "test_tool",
      });
      expect(response.content.length).toBeGreaterThan(0);
    }),
  );

const unicodeSurrogateSupport = {
  testEmojiInToolResults,
  testRealWorldLinkedInData,
  testUnpairedHighSurrogate,
};

export default unicodeSurrogateSupport;
