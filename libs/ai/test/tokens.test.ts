import { Clock, Effect, Exit, Scope, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { getModel, stream } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions } from "../src/types.ts";
import { envValue } from "./env.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { resolveApiKey } from "./oauth.ts";

const openaiCodexToken = await resolveApiKey("openai-codex");

function testTokensOnAbort<TApi extends Api>(
  llm: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const context: Context = {
        messages: [
          {
            role: "user",
            content: "Write a long poem with 20 stanzas about the beauty of nature.",
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
      const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
      void _compat;
      const llm: Model<"openai-completions"> = {
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
      const llm = getModel("openai", "gpt-5.4-mini");

      it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
        testTokensOnAbort(llm, { reasoningEffort: "low" }),
      );
    },
  );
});

describe("Token Statistics on Abort", () => {
  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider", () => {
    const llm = getModel("anthropic-api", "claude-sonnet-4-6");

    it("should include token stats when aborted mid-stream", { retry: 3, timeout: 30000 }, () =>
      testTokensOnAbort(llm),
    );
  });
});

describe("Token Statistics on Abort", () => {
  describe("OpenAI Codex Provider", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should include token stats when aborted mid-stream",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* Effect.promise(() => testTokensOnAbort(llm, { apiKey: openaiCodexToken }));
          }),
        ),
    );
  });
});
