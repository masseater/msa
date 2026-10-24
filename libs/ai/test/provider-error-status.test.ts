import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import anthropicMessages from "../src/api/anthropic-messages.ts";
import type typesModule from "../src/types.types.ts";
import providerFailure from "../src/utils/provider-failure.ts";
import transcript from "../src/utils/transcript.ts";
import openaiCodexStreamSupport from "./openai-codex-stream-support.ts";

const { isProviderUnusableError } = providerFailure;
const { resetCodexStateAfterEach, runCodex, stubCodexFetch } = openaiCodexStreamSupport;

const { stream: streamAnthropic } = anthropicMessages;
const { normalizeContext } = transcript;

resetCodexStateAfterEach();

const anthropicModel: typesModule.Model<"anthropic-messages"> = {
  api: "anthropic-messages",
  baseUrl: "https://api.anthropic.com",
  contextWindow: 100000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "claude-test",
  input: ["text"],
  maxTokens: 4096,
  name: "Claude Test",
  provider: "anthropic-api",
  reasoning: false,
};

function rejectingAnthropicClient(error: Error): never {
  function asResponse(): Promise<never> {
    return Promise.reject(error);
  }
  return { beta: { messages: { create: () => ({ asResponse }) } } } as never;
}

describe("provider failures record the HTTP status", () => {
  it("openai-codex-responses", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        stubCodexFetch(
          () =>
            new Response(JSON.stringify({ error: { message: "add funds" } }), {
              headers: { "content-type": "application/json" },
              status: 402,
            }),
        );
        const result = yield* runCodex({ maxRetries: 0 });
        expect(result.stopReason).toBe("error");
        expect(result.errorStatus).toBe(402);
        expect(isProviderUnusableError(result)).toBe(true);
      }),
    ));

  it("anthropic-messages", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          streamAnthropic(
            anthropicModel,
            normalizeContext({ messages: [{ content: "hi", role: "user", timestamp: 0 }] }),
            {
              apiKey: "test",
              client: rejectingAnthropicClient(
                Object.assign(new Error("Your credit balance is low"), { status: 402 }),
              ),
              maxRetries: 0,
            },
          ).result(),
        );
        expect(result.stopReason).toBe("error");
        expect(result.errorStatus).toBe(402);
      }),
    ));
});
