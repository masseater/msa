import { Clock, Effect, Exit, Scope, Stream } from "effect";
import { describe, expect, inject, it } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import env from "./env.ts";
import liveAuth from "./live-auth.ts";
import modelChoice from "./model-choice.ts";

const { hasLiveAuth } = liveAuth;

const { stream } = compatModule;

const { chooseModel, usesApi } = modelChoice;

type StreamOptionsWithExtras = typesModule.StreamOptions & Record<string, unknown>;

const { envValue } = env;

const openaiCodexToken = inject("storedApiKeys")["openai-codex"];

function testTokensOnAbort<TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const msg = yield* testTokensOnAbortStep1<TApi>(llm, options);

      if (
        llm.api === "openai-completions" ||
        llm.api === "openai-responses" ||
        llm.api === "openai-codex-responses"
      ) {
        expect(msg.usage.input).toBe(0);
        expect(msg.usage.output).toBe(0);
      } else {
        expect(msg.usage.input).toBeGreaterThan(0);
        expect(msg.usage.output).toBeGreaterThan(0);

        if (llm.cost.input > 0) {
          expect(msg.usage.cost.input).toBeGreaterThan(0);
          expect(msg.usage.cost.total).toBeGreaterThan(0);
        }
      }
    }),
  );
}

describe("Token Statistics on Abort", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider",
    () => {
      const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
      void _compat;
      const llm: typesModule.Model<"openai-completions"> = {
        ...baseModel,
        api: "openai-completions",
      };

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider",
    () => {
      const llm = chooseModel(
        "openai",
        "reasoning Responses",
        (model) => usesApi("openai-responses")(model) && model.reasoning,
      );

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm, { reasoningEffort: "low" }),
      );
    },
  );
});

describe("Token Statistics on Abort", () => {
  describe.skipIf(!hasLiveAuth("anthropic-api"))("Anthropic Provider", () => {
    const llm = chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages"));

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      testTokensOnAbort(llm),
    );
  });
});

const gpt55ShouldIncludeToken = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = chooseModel("openai-codex", "Codex");
      yield* Effect.promise(() => testTokensOnAbort(llm, { apiKey: openaiCodexToken }));
    }),
  );

describe("Token Statistics on Abort", () => {
  describe("OpenAI Codex Provider", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "Codex - should include token stats when aborted mid-stream",
      { retry: 3, timeout: 30000 },
      gpt55ShouldIncludeToken,
    );
  });
});

function* testTokensOnAbortStep1<TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras,
) {
  const context: typesModule.Context = {
    messages: [
      {
        content: "Write a long poem with 20 stanzas about the beauty of nature.",
        role: "user",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
    systemPrompt: "You are a helpful assistant.",
  };

  const abortScope = yield* Scope.make();
  const signal = yield* Scope.provide(abortScope)(Effect.abortSignal);
  const response = stream(llm, context, { ...options, signal });

  let abortFired = false;
  let text = "";
  yield* Stream.fromAsyncIterable(response, (error) => error).pipe(
    Stream.orDie,
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        if (!abortFired && (event.type === "text_delta" || event.type === "thinking_delta")) {
          text += event.delta;
          if (text.length >= 1000) {
            abortFired = true;
            yield* Scope.close(abortScope, Exit.void);
          }
        }
      }),
    ),
  );

  const msg = yield* Effect.promise(() => response.result());

  expect(msg.stopReason).toBe("aborted");
  return msg;
}
