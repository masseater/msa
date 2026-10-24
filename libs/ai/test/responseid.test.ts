import { Clock, Effect } from "effect";
import { describe, expect, inject, it } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import env from "./env.ts";
import liveAuth from "./live-auth.ts";
import modelChoice from "./model-choice.ts";

const { hasLiveAuth } = liveAuth;

const { complete } = compatModule;

const { chooseModel, usesApi } = modelChoice;

const { envValue } = env;

type StreamOptionsWithExtras = typesModule.StreamOptions & Record<string, unknown>;

const openaiCodexToken = inject("storedApiKeys")["openai-codex"];

const expectResponseId = Effect.fn("expectResponseId")(function* <TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const context: typesModule.Context = {
    messages: [
      {
        content: "Reply with exactly: response id test",
        role: "user",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
    systemPrompt: "You are a helpful assistant. Be concise.",
  };

  const response = yield* Effect.promise(() => complete(model, context, options));

  expect(response.stopReason, response.errorMessage).not.toBe("error");
  expect(response.responseId).toBeTruthy();
  expect(typeof response.responseId).toBe("string");
});

describe("responseId E2E Tests", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider",
    () => {
      const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
      void _compat;
      const llm: typesModule.Model<"openai-completions"> = {
        ...baseModel,
        api: "openai-completions",
      };

      it("should expose responseId", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(expectResponseId(llm)),
      );
    },
  );
});

describe("responseId E2E Tests", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider",
    () => {
      const llm = chooseModel(
        "openai",
        "reasoning Responses",
        (model) => usesApi("openai-responses")(model) && model.reasoning,
      );

      it("should expose responseId", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(expectResponseId(llm)),
      );
    },
  );

  describe.skipIf(!hasLiveAuth("anthropic-api"))("Anthropic Provider", () => {
    const llm = chooseModel("anthropic-api", "Messages", usesApi("anthropic-messages"));

    it("should expose responseId", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(expectResponseId(llm)),
    );
  });
});

describe("responseId E2E Tests", () => {
  describe("OpenAI Codex Provider", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should expose responseId",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = chooseModel("openai-codex", "Codex");
            yield* expectResponseId(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );
  });
});
