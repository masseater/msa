import { describe, expect, it } from "vite-plus/test";

import { fauxAssistantMessage } from "../src/providers/faux.ts";
import { withOpenCodeSessionHeader } from "../src/providers/opencode-headers.ts";
import type { Api, Model, ProviderStreams, StreamOptions } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const model: Model<Api> = {
  api: "test-api",
  baseUrl: "https://opencode.ai/zen/v1",
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "test-model",
  input: ["text"],
  maxTokens: 100,
  name: "Test model",
  provider: "opencode",
  reasoning: false,
};
const context = normalizeContext({ messages: [{ content: "hi", role: "user", timestamp: 0 }] });

function completedStream(): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const message = fauxAssistantMessage("ok");
  stream.push({ partial: message, type: "start" });
  stream.push({ message, reason: "stop", type: "done" });
  stream.end(message);
  return stream;
}

function recordingStreams(capture: (options: StreamOptions | undefined) => void): ProviderStreams {
  return {
    stream: (_model, _context, options) => {
      capture(options);
      return completedStream();
    },
    streamSimple: (_model, _context, options) => {
      capture(options);
      return completedStream();
    },
  };
}

describe("OpenCode provider headers", () => {
  it.each(["stream", "streamSimple"] as const)(
    "maps sessionId for %s requests even without cache retention",
    (method) => {
      let captured: StreamOptions | undefined;
      const streams = withOpenCodeSessionHeader(
        recordingStreams((options) => {
          captured = options;
        }),
      );

      streams[method](model, context, { cacheRetention: "none", sessionId: "conversation-1" });

      expect(captured?.headers).toEqual({ "x-opencode-session": "conversation-1" });
    },
  );

  it.each([
    {
      expected: { "X-OpenCode-Session": "caller-value" },
      headers: { "X-OpenCode-Session": "caller-value" },
    },
    { expected: { "X-OpenCode-Session": null }, headers: { "X-OpenCode-Session": null } },
  ] as const)("preserves a case-insensitive caller override", ({ headers, expected }) => {
    let captured: StreamOptions | undefined;
    const streams = withOpenCodeSessionHeader(
      recordingStreams((options) => {
        captured = options;
      }),
    );

    streams.streamSimple(model, context, { headers, sessionId: "generated-value" });

    expect(captured?.headers).toEqual(expected);
  });

  it("does not fabricate a session header when sessionId is absent", () => {
    let captured: StreamOptions | undefined;
    const streams = withOpenCodeSessionHeader(
      recordingStreams((options) => {
        captured = options;
      }),
    );

    streams.streamSimple(model, context, { headers: { "x-custom": "value" } });

    expect(captured?.headers).toEqual({ "x-custom": "value" });
  });
});
