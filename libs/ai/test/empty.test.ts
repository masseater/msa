import { Clock, Effect } from "effect";
import { describe, expect, inject, it } from "vite-plus/test";

import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import env from "./env.ts";
import liveAuth from "./live-auth.ts";
import modelChoice from "./model-choice.ts";

const { hasLiveAuth } = liveAuth;

const { complete } = compat;

const { chooseModel, usesApi } = modelChoice;

type StreamOptionsWithExtras = typesModule.StreamOptions & Record<string, unknown>;

const { envValue } = env;

const openaiCodexToken = inject("storedApiKeys")["openai-codex"];

const testEmptyMessage = Effect.fn("testEmptyMessage")(function* <TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const emptyMessage: typesModule.UserMessage = {
    content: [],
    role: "user",
    timestamp: yield* Clock.currentTimeMillis,
  };

  const context: typesModule.Context = {
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

const testEmptyStringMessage = Effect.fn("testEmptyStringMessage")(function* <
  TApi extends typesModule.Api,
>(llm: typesModule.Model<TApi>, options: StreamOptionsWithExtras = {}) {
  const context: typesModule.Context = {
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
  TApi extends typesModule.Api,
>(llm: typesModule.Model<TApi>, options: StreamOptionsWithExtras = {}) {
  const context: typesModule.Context = {
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
  TApi extends typesModule.Api,
>(llm: typesModule.Model<TApi>, options: StreamOptionsWithExtras = {}) {
  const emptyAssistant: typesModule.AssistantMessage = {
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

  const context: typesModule.Context = {
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
      const llm = chooseModel(
        "openai",
        "reasoning Responses",
        (model) => usesApi("openai-responses")(model) && model.reasoning,
      );

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
  describe.skipIf(!hasLiveAuth("anthropic-api"))("Anthropic Provider Empty Messages", () => {
    const llm = chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages"));

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
      const llm = chooseModel("openai-codex", "Codex");
      yield* testEmptyMessage(llm, { apiKey: openaiCodexToken });
    }),
  );

const gpt55ShouldHandleEmpty2 = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = chooseModel("openai-codex", "Codex");
      yield* testEmptyStringMessage(llm, { apiKey: openaiCodexToken });
    }),
  );

const gpt55ShouldHandleWhitespace = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = chooseModel("openai-codex", "Codex");
      yield* testWhitespaceOnlyMessage(llm, { apiKey: openaiCodexToken });
    }),
  );

const gpt55ShouldHandleEmpty3 = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = chooseModel("openai-codex", "Codex");
      yield* testEmptyAssistantMessage(llm, { apiKey: openaiCodexToken });
    }),
  );

describe("AI Providers Empty Message Tests", () => {
  describe("OpenAI Codex Provider Empty Messages", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "Codex - should handle empty content array",
      { retry: 3, timeout: 30000 },
      gpt55ShouldHandleEmpty,
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "Codex - should handle empty string content",
      { retry: 3, timeout: 30000 },
      gpt55ShouldHandleEmpty2,
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "Codex - should handle whitespace-only content",
      { retry: 3, timeout: 30000 },
      gpt55ShouldHandleWhitespace,
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "Codex - should handle empty assistant message in conversation",
      { retry: 3, timeout: 30000 },
      gpt55ShouldHandleEmpty3,
    );
  });
});
