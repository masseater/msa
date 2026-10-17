import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { Effect, Stream } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import type { Context, Model, Tool } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import { decodeJson } from "./json-codec.ts";

interface CapturedRequest {
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

function createModel(
  baseUrl: string,
  compat?: Model<"anthropic-messages">["compat"],
): Model<"anthropic-messages"> {
  return {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    api: "anthropic-messages",
    provider: "test-anthropic",
    baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32000,
    compat: { forceAdaptiveThinking: true, ...compat },
  };
}

const tool: Tool = {
  name: "lookup",
  description: "Look up a value",
  parameters: Type.Object({ value: Type.String() }),
};

function createContext(tools: Tool[] = [tool]): Context {
  return {
    messages: [{ role: "user", content: "Use the tool", timestamp: Date.now() }],
    ...(tools.length > 0 ? { tools } : {}),
  };
}

function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const chunks: Buffer[] = [];
      yield* Stream.fromAsyncIterable(request, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }),
        ),
      );
      return (yield* decodeJson(Buffer.concat(chunks).toString("utf8"))) as Record<string, unknown>;
    }),
  );
}

function writeEmptySseResponse(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end();
}

async function captureAnthropicRequest(
  compat: Model<"anthropic-messages">["compat"],
  context: Context,
): Promise<CapturedRequest> {
  let capturedRequest: CapturedRequest | undefined;

  const server = createServer((request, response) =>
    Effect.runPromise(
      Effect.gen(function* () {
        capturedRequest = {
          headers: request.headers,
          body: yield* Effect.promise(() => readRequestBody(request)),
        };
        writeEmptySseResponse(response);
      }),
    ),
  );

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  try {
    const stream = streamAnthropic(
      createModel(`http://127.0.0.1:${address.port}`, compat),
      normalizeContext(context),
      {
        apiKey: "test-key",
        cacheRetention: "none",
      },
    );

    await Effect.runPromise(
      Stream.fromAsyncIterable(stream, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEachWhile((event) =>
          Effect.sync(() => {
            if (event.type === "done" || event.type === "error") return false;
            return true;
          }),
        ),
      ),
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  if (capturedRequest === undefined) {
    throw new Error("Anthropic request was not captured");
  }
  return capturedRequest;
}

function getFirstTool(body: Record<string, unknown>): Record<string, unknown> {
  const tools = body["tools"];
  if (!Array.isArray(tools) || typeof tools[0] !== "object" || tools[0] === null) {
    throw new Error("Expected first tool in request body");
  }
  return tools[0] as Record<string, unknown>;
}

describe("Anthropic eager tool input streaming compatibility", () => {
  it("sends per-tool eager_input_streaming by default", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const request = yield* Effect.promise(() =>
          captureAnthropicRequest(undefined, createContext()),
        );

        expect(getFirstTool(request.body)["eager_input_streaming"]).toBe(true);
        expect(request.headers["anthropic-beta"]).toBeUndefined();
      }),
    ));

  it("uses the legacy fine-grained tool streaming beta when eager tool input streaming is disabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const request = yield* Effect.promise(() =>
          captureAnthropicRequest({ supportsEagerToolInputStreaming: false }, createContext()),
        );

        expect(getFirstTool(request.body)["eager_input_streaming"]).toBeUndefined();
        expect(request.headers["anthropic-beta"]).toBe("fine-grained-tool-streaming-2025-05-14");
      }),
    ));

  it("does not send the legacy fine-grained tool streaming beta when there are no tools", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const request = yield* Effect.promise(() =>
          captureAnthropicRequest({ supportsEagerToolInputStreaming: false }, createContext([])),
        );

        expect(request.body["tools"]).toBeUndefined();
        expect(request.headers["anthropic-beta"]).toBeUndefined();
      }),
    ));
});
