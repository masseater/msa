import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { complete, getModel } from "../src/compat.ts";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  StreamOptions,
  UserMessage,
} from "../src/types.ts";
import { envValue } from "./env.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { resolveApiKey } from "./oauth.ts";

const oauthTokens = await Promise.all([resolveApiKey("anthropic"), resolveApiKey("openai-codex")]);
const [anthropicOAuthToken, openaiCodexToken] = oauthTokens;

const testEmptyMessage = Effect.fn("testEmptyMessage")(function* <TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const emptyMessage: UserMessage = {
    role: "user",
    content: [],
    timestamp: yield* Clock.currentTimeMillis,
  };

  const context: Context = {
    messages: [emptyMessage],
  };

  const response = yield* Effect.promise(() => complete(llm, context, options));

  expect(response).toBeDefined();
  expect(response.role).toBe("assistant");
  if (response.stopReason === "error") {
    expect(response.errorMessage).toBeDefined();
  } else {
    expect(response.content).toBeDefined();
  }
});

const testEmptyStringMessage = Effect.fn("testEmptyStringMessage")(function* <TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const context: Context = {
    messages: [
      {
        role: "user",
        content: "",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };

  const response = yield* Effect.promise(() => complete(llm, context, options));

  expect(response).toBeDefined();
  expect(response.role).toBe("assistant");

  if (response.stopReason === "error") {
    expect(response.errorMessage).toBeDefined();
  } else {
    expect(response.content).toBeDefined();
  }
});

const testWhitespaceOnlyMessage = Effect.fn("testWhitespaceOnlyMessage")(function* <
  TApi extends Api,
>(llm: Model<TApi>, options: StreamOptionsWithExtras = {}) {
  const context: Context = {
    messages: [
      {
        role: "user",
        content: "   \n\t  ",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };

  const response = yield* Effect.promise(() => complete(llm, context, options));

  expect(response).toBeDefined();
  expect(response.role).toBe("assistant");

  if (response.stopReason === "error") {
    expect(response.errorMessage).toBeDefined();
  } else {
    expect(response.content).toBeDefined();
  }
});

const testEmptyAssistantMessage = Effect.fn("testEmptyAssistantMessage")(function* <
  TApi extends Api,
>(llm: Model<TApi>, options: StreamOptionsWithExtras = {}) {
  const emptyAssistant: AssistantMessage = {
    role: "assistant",
    content: [],
    api: llm.api,
    provider: llm.provider,
    model: llm.id,
    usage: {
      input: 10,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 10,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: yield* Clock.currentTimeMillis,
  };

  const context: Context = {
    messages: [
      {
        role: "user",
        content: "Hello, how are you?",
        timestamp: yield* Clock.currentTimeMillis,
      },
      emptyAssistant,
      {
        role: "user",
        content: "Please respond this time.",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };

  const response = yield* Effect.promise(() => complete(llm, context, options));

  expect(response).toBeDefined();
  expect(response.role).toBe("assistant");

  if (response.stopReason === "error") {
    expect(response.errorMessage).toBeDefined();
  } else {
    expect(response.content).toBeDefined();
    expect(response.content.length).toBeGreaterThan(0);
  }
});

describe("AI Providers Empty Message Tests", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider Empty Messages",
    () => {
      const llm = getModel("openai", "gpt-4o-mini");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );
});

describe("AI Providers Empty Message Tests", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider Empty Messages",
    () => {
      const llm = getModel("openai", "gpt-5-mini");

      it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyMessage(llm)),
      );

      it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testEmptyStringMessage(llm)),
      );

      it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(testWhitespaceOnlyMessage(llm)),
      );

      it(
        "should handle empty assistant message in conversation",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testEmptyAssistantMessage(llm)),
      );
    },
  );
});

describe("AI Providers Empty Message Tests", () => {
  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider Empty Messages", () => {
    const llm = getModel("anthropic", "claude-haiku-4-5");

    it("should handle empty content array", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyMessage(llm)),
    );

    it("should handle empty string content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyStringMessage(llm)),
    );

    it("should handle whitespace-only content", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testWhitespaceOnlyMessage(llm)),
    );

    it("should handle empty assistant message in conversation", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(testEmptyAssistantMessage(llm)),
    );
  });
});

describe("AI Providers Empty Message Tests", () => {
  describe("Anthropic OAuth Provider Empty Messages", () => {
    const llm = getModel("anthropic", "claude-haiku-4-5");

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle empty content array",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testEmptyMessage(llm, { apiKey: anthropicOAuthToken })),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle empty string content",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testEmptyStringMessage(llm, { apiKey: anthropicOAuthToken })),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle whitespace-only content",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testWhitespaceOnlyMessage(llm, { apiKey: anthropicOAuthToken })),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle empty assistant message in conversation",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testEmptyAssistantMessage(llm, { apiKey: anthropicOAuthToken })),
    );
  });
});

describe("AI Providers Empty Message Tests", () => {
  describe("OpenAI Codex Provider Empty Messages", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle empty content array",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* testEmptyMessage(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle empty string content",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* testEmptyStringMessage(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle whitespace-only content",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* testWhitespaceOnlyMessage(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle empty assistant message in conversation",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* testEmptyAssistantMessage(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );
  });
});
