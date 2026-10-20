import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import anthropicMessages from "../src/api/anthropic-messages.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import transcript from "../src/utils/transcript.ts";
import jsonCodec from "./json-codec.ts";

const { currentTimeMillis } = clock;
const { stream: streamAnthropic } = anthropicMessages;
const { normalizeContext } = transcript;

const { decodeJson } = jsonCodec;

const createModel = (
  compat?: typesModule.Model<"anthropic-messages">["compat"],
): typesModule.Model<"anthropic-messages"> => ({
  api: "anthropic-messages",
  baseUrl: "https://anthropic.test",
  compat: { forceAdaptiveThinking: true, ...compat },
  contextWindow: 200000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "claude-test",
  input: ["text"],
  maxTokens: 32000,
  name: "Claude Test",
  provider: "test-anthropic",
  reasoning: true,
});

const lookupTool: typesModule.Tool = {
  description: "Look up a value",
  name: "lookup",
  parameters: Type.Object({ value: Type.String() }),
};

const createContext = (tools: typesModule.Tool[]): typesModule.Context => ({
  messages: [{ content: "Use the tool", role: "user", timestamp: currentTimeMillis() }],
  ...(tools.length > 0 ? { tools } : {}),
});

const captureAnthropicRequest = (
  compat: typesModule.Model<"anthropic-messages">["compat"],
  tools: typesModule.Tool[] = [lookupTool],
) =>
  Effect.gen(function* () {
    const captured: { request?: Request } = {};
    yield* Effect.promise(() =>
      streamAnthropic(createModel(compat), normalizeContext(createContext(tools)), {
        apiKey: "test-key",
        cacheRetention: "none",
        fetch: (input, init) => {
          captured.request = new Request(input, init);
          return Promise.resolve(
            new Response("", { headers: { "content-type": "text/event-stream" }, status: 200 }),
          );
        },
      }).result(),
    );
    const { request } = captured;
    if (request === undefined) throw new Error("Anthropic request was not captured");
    const body = (yield* decodeJson(yield* Effect.promise(() => request.text()))) as {
      tools?: Array<Record<string, unknown>>;
    };
    return { beta: request.headers.get("anthropic-beta"), body };
  });

const sendsPerToolEagerStreaming = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { beta, body } = yield* captureAnthropicRequest(undefined);
      expect(body.tools?.[0]?.["eager_input_streaming"]).toBe(true);
      expect(beta).toBeNull();
    }),
  );

const usesLegacyBetaWhenDisabled = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { beta, body } = yield* captureAnthropicRequest({
        supportsEagerToolInputStreaming: false,
      });
      expect(body.tools?.[0]?.["eager_input_streaming"]).toBeUndefined();
      expect(beta).toBe("fine-grained-tool-streaming-2025-05-14");
    }),
  );

const skipsLegacyBetaWithoutTools = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { beta, body } = yield* captureAnthropicRequest(
        { supportsEagerToolInputStreaming: false },
        [],
      );
      expect(body.tools).toBeUndefined();
      expect(beta).toBeNull();
    }),
  );

describe("Anthropic eager tool input streaming compatibility", () => {
  it("sends per-tool eager_input_streaming by default", sendsPerToolEagerStreaming);
  it(
    "uses the legacy fine-grained tool streaming beta when eager tool input streaming is disabled",
    usesLegacyBetaWhenDisabled,
  );
  it(
    "does not send the legacy fine-grained tool streaming beta when there are no tools",
    skipsLegacyBetaWithoutTools,
  );
});
