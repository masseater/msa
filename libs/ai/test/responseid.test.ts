import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { complete, getModel } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions } from "../src/types.ts";
import { envValue } from "./env.ts";
import { resolveApiKey } from "./oauth.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

const openaiCodexToken = await resolveApiKey("openai-codex");

const expectResponseId = Effect.fn("expectResponseId")(function* <TApi extends Api>(
  model: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const context: Context = {
    systemPrompt: "You are a helpful assistant. Be concise.",
    messages: [
      {
        role: "user",
        content: "Reply with exactly: response id test",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
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
      const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini");
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
    const llm = getModel("anthropic", "claude-sonnet-4-5");

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
