import { Clock, Effect, Exit, Scope, Stream } from "effect";
import { describe, expect, inject, it } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { complete, stream } = compatModule;

const { chooseModel, usesApi } = modelChoice;

type StreamOptionsWithExtras = typesModule.StreamOptions & Record<string, unknown>;

const { envValue } = env;

const openaiCodexToken = inject("storedApiKeys")["openai-codex"];

const testAbortSignal = Effect.fn("testAbortSignal")(function* <TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const context: typesModule.Context = {
    messages: [
      {
        content: "What is 15 + 27? Think step by step. Then list 50 first names.",
        role: "user",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
    systemPrompt: "You are a helpful assistant.",
  };

  const abortScope = yield* Scope.make();
  const signal = yield* Scope.provide(abortScope)(Effect.abortSignal);
  let abortFired = false;
  let eventAfterAbort = false;
  let text = "";
  const response = stream(llm, context, { ...options, signal });
  yield* Stream.fromAsyncIterable(response, (error) => error).pipe(
    Stream.orDie,
    Stream.runForEachWhile((event) =>
      Effect.gen(function* () {
        if (abortFired) {
          eventAfterAbort = true;
          return false;
        }
        if (event.type === "text_delta" || event.type === "thinking_delta") {
          text += event.delta;
        }
        if (text.length >= 50) {
          yield* Scope.close(abortScope, Exit.void);
          abortFired = true;
        }
        return true;
      }),
    ),
  );
  if (eventAfterAbort) return;
  yield* testAbortSignalStep1<TApi>(response, context, llm, options);
});

const testImmediateAbort = Effect.fn("testImmediateAbort")(function* <TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const signal = AbortSignal.abort();

  const context: typesModule.Context = {
    messages: [{ content: "Hello", role: "user", timestamp: yield* Clock.currentTimeMillis }],
  };

  const response = yield* Effect.promise(() => complete(llm, context, { ...options, signal }));
  expect(response.stopReason).toBe("aborted");
});

describe("AI Providers Abort Tests", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider Abort",
    () => {
      const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
      void _compat;
      const llm: typesModule.Model<"openai-completions"> = {
        ...baseModel,
        api: "openai-completions",
      };

      it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

      it("should handle immediate abort", { retry: 3 }, () =>
        Effect.runPromise(testImmediateAbort(llm)),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider Abort",
    () => {
      const llm = chooseModel(
        "openai",
        "reasoning Responses",
        (model) => usesApi("openai-responses")(model) && model.reasoning,
      );

      it("should abort mid-stream", { retry: 3 }, () => Effect.runPromise(testAbortSignal(llm)));

      it("should handle immediate abort", { retry: 3 }, () =>
        Effect.runPromise(testImmediateAbort(llm)),
      );
    },
  );
});

const shouldAbortMidStream = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = chooseModel("openai-codex", "Codex");
      yield* testAbortSignal(llm, { apiKey: openaiCodexToken });
    }),
  );

const shouldHandleImmediateAbort = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = chooseModel("openai-codex", "Codex");
      yield* testImmediateAbort(llm, { apiKey: openaiCodexToken });
    }),
  );

describe("AI Providers Abort Tests", () => {
  describe("OpenAI Codex Provider Abort", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should abort mid-stream",
      { retry: 3 },
      shouldAbortMidStream,
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should handle immediate abort",
      { retry: 3 },
      shouldHandleImmediateAbort,
    );
  });
});

function* testAbortSignalStep1<TApi extends typesModule.Api>(
  response: typesModule.AssistantMessageEventStream,
  context: typesModule.Context,
  llm: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras,
) {
  const msg = yield* Effect.promise(() => response.result());

  expect(msg.stopReason).toBe("aborted");
  expect(msg.content.length).toBeGreaterThan(0);

  context.messages.push(msg, {
    content: "Please continue, but only generate 5 names.",
    role: "user",
    timestamp: yield* Clock.currentTimeMillis,
  });

  const followUp = yield* Effect.promise(() => complete(llm, context, options));
  expect(followUp.stopReason).toBe("stop");
  expect(followUp.content.length).toBeGreaterThan(0);
}
