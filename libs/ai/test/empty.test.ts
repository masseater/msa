import { Clock, Effect } from "effect";
import { describe, expect, inject, it } from "vite-plus/test";

import { complete, getModel } from "../src/compat.ts";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  StreamOptions,
  UserMessage,
} from "../src/types.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel } = modelChoice;

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

const { envValue } = env;

const openaiCodexToken = inject("storedApiKeys")["openai-codex"];

const testEmptyMessage = Effect.fn("testEmptyMessage")(function* <TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const emptyMessage: UserMessage = {
    content: [],
    role: "user",
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
        content: "",
        role: "user",
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
        content: "   \n\t  ",
        role: "user",
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
    api: llm.api,
    content: [],
    model: llm.id,
    provider: llm.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp: yield* Clock.currentTimeMillis,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 10,
      output: 0,
      totalTokens: 10,
    },
  };

  const context: Context = {
    messages: [
      {
        content: "Hello, how are you?",
        role: "user",
        timestamp: yield* Clock.currentTimeMillis,
      },
      emptyAssistant,
      {
        content: "Please respond this time.",
        role: "user",
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
      const llm = chooseModel("openai", "direct OpenAI");

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
    const llm = getModel("anthropic-api", "claude-haiku-4-5");

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

const gpt55ShouldHandleEmpty = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = getModel("openai-codex", "gpt-5.5");
      yield* testEmptyMessage(llm, { apiKey: openaiCodexToken });
    }),
  );

const gpt55ShouldHandleEmpty2 = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = getModel("openai-codex", "gpt-5.5");
      yield* testEmptyStringMessage(llm, { apiKey: openaiCodexToken });
    }),
  );

const gpt55ShouldHandleWhitespace = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = getModel("openai-codex", "gpt-5.5");
      yield* testWhitespaceOnlyMessage(llm, { apiKey: openaiCodexToken });
    }),
  );

const gpt55ShouldHandleEmpty3 = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = getModel("openai-codex", "gpt-5.5");
      yield* testEmptyAssistantMessage(llm, { apiKey: openaiCodexToken });
    }),
  );

describe("AI Providers Empty Message Tests", () => {
  describe("OpenAI Codex Provider Empty Messages", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle empty content array",
      { retry: 3, timeout: 30000 },
      gpt55ShouldHandleEmpty,
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle empty string content",
      { retry: 3, timeout: 30000 },
      gpt55ShouldHandleEmpty2,
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle whitespace-only content",
      { retry: 3, timeout: 30000 },
      gpt55ShouldHandleWhitespace,
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should handle empty assistant message in conversation",
      { retry: 3, timeout: 30000 },
      gpt55ShouldHandleEmpty3,
    );
  });
});
