import { Clock, Effect } from "effect";
import { describe, expect, inject, it } from "vite-plus/test";

import { complete, getModel } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions } from "../src/types.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel } = modelChoice;

const { envValue } = env;

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

const openaiCodexToken = inject("storedApiKeys")["openai-codex"];

const expectResponseId = Effect.fn("expectResponseId")(function* <TApi extends Api>(
  model: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const context: Context = {
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
      const llm: Model<"openai-completions"> = {
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
      const llm = getModel("openai", "gpt-5-mini");

      it("should expose responseId", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(expectResponseId(llm)),
      );
    },
  );

  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider", () => {
    const llm = getModel("anthropic-api", "claude-sonnet-4-5");

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
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* expectResponseId(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );
  });
});
