import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import eventStream from "../src/utils/event-stream.ts";

const { currentTimeMillis } = clock;
const { complete, registerApiProvider, resetApiProviders } = compat;
const { AssistantMessageEventStream } = eventStream;

const context: typesModule.Context = {
  messages: [{ content: "hi", role: "user", timestamp: currentTimeMillis() }],
};

const model: typesModule.Model<"openai-responses"> = {
  api: "openai-responses",
  baseUrl: "https://example.test/v1",
  contextWindow: 128000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "test-model",
  input: ["text"],
  maxTokens: 4096,
  name: "Test Model",
  provider: "custom-openai",
  reasoning: false,
};

function message(): typesModule.AssistantMessage {
  return {
    api: model.api,
    content: [{ text: "ok", type: "text" }],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

describe("compat legacy API fallback", () => {
  afterEach(() => {
    resetApiProviders();
  });

  it("dispatches unknown providers through the legacy API registry", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let capturedApiKey: string | undefined;
        registerApiProvider({
          api: "openai-responses",
          stream: (_model, _context, options) => {
            capturedApiKey = options?.apiKey;
            const stream = new AssistantMessageEventStream();
            const output = message();
            stream.push({ partial: output, type: "start" });
            stream.push({ message: output, reason: "stop", type: "done" });
            stream.end(output);
            return stream;
          },
          streamSimple: (_model, _context, options) => {
            capturedApiKey = options?.apiKey;
            const stream = new AssistantMessageEventStream();
            const output = message();
            stream.push({ partial: output, type: "start" });
            stream.push({ message: output, reason: "stop", type: "done" });
            stream.end(output);
            return stream;
          },
        });

        yield* Effect.promise(() => complete(model, context, { apiKey: "request-key" }));

        expect(capturedApiKey).toBe("request-key");
      }),
    ));
});
