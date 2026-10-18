import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { complete, getModel } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions, ToolResultMessage } from "../src/types.ts";
import { envValue } from "./env.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { currentTimeMillis } from "../src/utils/clock.ts";
import { resolveApiKey } from "./oauth.ts";

const emptySchema = Type.Object({});

const oauthTokens = await Promise.all([resolveApiKey("anthropic"), resolveApiKey("openai-codex")]);
const [anthropicOAuthToken, openaiCodexToken] = oauthTokens;

async function testEmojiInToolResults<TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const toolCallId = "test_1";
  const context: Context = {
    systemPrompt: "You are a helpful assistant.",
    messages: [
      {
        role: "user",
        content: "Use the test tool",
        timestamp: currentTimeMillis(),
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: toolCallId,
            name: "test_tool",
            arguments: {},
          },
        ],
        api: llm.api,
        provider: llm.provider,
        model: llm.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: currentTimeMillis(),
      },
    ],
    tools: [
      {
        name: "test_tool",
        description: "A test tool",
        parameters: emptySchema,
      },
    ],
  };

  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCallId,
    toolName: "test_tool",
    content: [
      {
        type: "text",
        text: `Test with emoji 🙈 and other characters:
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
      },
    ],
    isError: false,
    timestamp: currentTimeMillis(),
  };

  context.messages.push(toolResult, {
    role: "user",
    content: "Summarize the tool result briefly.",
    timestamp: currentTimeMillis(),
  });

  const response = await complete(llm, context, options);

  expect(response.stopReason).not.toBe("error");
  expect(response.errorMessage).toBeFalsy();
  expect(response.content.length).toBeGreaterThan(0);
}

async function testRealWorldLinkedInData<TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const toolCallId = "linkedin_1";
  const context: Context = {
    systemPrompt: "You are a helpful assistant.",
    messages: [
      {
        role: "user",
        content: "Use the linkedin tool to get comments",
        timestamp: currentTimeMillis(),
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: toolCallId,
            name: "linkedin_skill",
            arguments: {},
          },
        ],
        api: llm.api,
        provider: llm.provider,
        model: llm.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: currentTimeMillis(),
      },
    ],
    tools: [
      {
        name: "linkedin_skill",
        description: "Get LinkedIn comments",
        parameters: emptySchema,
      },
    ],
  };

  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCallId,
    toolName: "linkedin_skill",
    content: [
      {
        type: "text",
        text: `Post: Hab einen "Generative KI für Nicht-Techniker" Workshop gebaut.
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
      },
    ],
    isError: false,
    timestamp: currentTimeMillis(),
  };

  context.messages.push(toolResult, {
    role: "user",
    content: "How many comments are there?",
    timestamp: currentTimeMillis(),
  });

  const response = await complete(llm, context, options);

  expect(response.stopReason).not.toBe("error");
  expect(response.errorMessage).toBeFalsy();
  expect(response.content.some((b) => b.type === "text")).toBe(true);
}

async function testUnpairedHighSurrogate<TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const toolCallId = "test_2";
  const context: Context = {
    systemPrompt: "You are a helpful assistant.",
    messages: [
      {
        role: "user",
        content: "Use the test tool",
        timestamp: currentTimeMillis(),
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: toolCallId,
            name: "test_tool",
            arguments: {},
          },
        ],
        api: llm.api,
        provider: llm.provider,
        model: llm.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: currentTimeMillis(),
      },
    ],
    tools: [
      {
        name: "test_tool",
        description: "A test tool",
        parameters: emptySchema,
      },
    ],
  };

  const unpairedSurrogate = String.fromCharCode(0xd83d);

  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCallId,
    toolName: "test_tool",
    content: [
      {
        type: "text",
        text: `Text with unpaired surrogate: ${unpairedSurrogate} <- should be sanitized`,
      },
    ],
    isError: false,
    timestamp: currentTimeMillis(),
  };

  context.messages.push(toolResult, {
    role: "user",
    content: "What did the tool return?",
    timestamp: currentTimeMillis(),
  });

  const response = await complete(llm, context, options);

  expect(response.stopReason).not.toBe("error");
  expect(response.errorMessage).toBeFalsy();
  expect(response.content.length).toBeGreaterThan(0);
}

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider Unicode Handling",
    () => {
      const llm = getModel("openai", "gpt-4o-mini");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider Unicode Handling",
    () => {
      const llm = getModel("openai", "gpt-5-mini");

      it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
        testEmojiInToolResults(llm),
      );

      it(
        "should handle real-world LinkedIn comment data with emoji",
        { retry: 3, timeout: 30000 },
        () => testRealWorldLinkedInData(llm),
      );

      it(
        "should handle unpaired high surrogate (0xD83D) in tool results",
        { retry: 3, timeout: 30000 },
        () => testUnpairedHighSurrogate(llm),
      );
    },
  );
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider Unicode Handling", () => {
    const llm = getModel("anthropic", "claude-haiku-4-5");

    it("should handle emoji in tool results", { retry: 3, timeout: 30000 }, () =>
      testEmojiInToolResults(llm),
    );

    it(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm),
    );

    it(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm),
    );
  });
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe("Anthropic OAuth Provider Unicode Handling", () => {
    const llm = getModel("anthropic", "claude-haiku-4-5");

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle emoji in tool results",
      { retry: 3, timeout: 30000 },
      () => testEmojiInToolResults(llm, { apiKey: anthropicOAuthToken }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () => testRealWorldLinkedInData(llm, { apiKey: anthropicOAuthToken }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () => testUnpairedHighSurrogate(llm, { apiKey: anthropicOAuthToken }),
    );
  });
});

describe("AI Providers Unicode Surrogate Pair Tests", () => {
  describe("OpenAI Codex Provider Unicode Handling", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle emoji in tool results",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* Effect.promise(() => testEmojiInToolResults(llm, { apiKey: openaiCodexToken }));
          }),
        ),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle real-world LinkedIn comment data with emoji",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* Effect.promise(() =>
              testRealWorldLinkedInData(llm, { apiKey: openaiCodexToken }),
            );
          }),
        ),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle unpaired high surrogate (0xD83D) in tool results",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* Effect.promise(() =>
              testUnpairedHighSurrogate(llm, { apiKey: openaiCodexToken }),
            );
          }),
        ),
    );
  });
});
