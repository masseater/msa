import { createServer, type Server } from "node:http";

import { Clock, Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { stream as streamBedrock } from "../src/api/bedrock-converse-stream.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import type { Model, ProviderResponse } from "../src/types.ts";

const MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

let server: Server | undefined;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      if (server === undefined) return;
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => {
            server?.close((error) => (error === undefined ? resolve() : reject(error)));
          }),
      );
      server = undefined;
    }),
  ),
);

const startBedrockResponseServer = Effect.fn("startBedrockResponseServer")(function* () {
  server = createServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "application/vnd.amazon.eventstream",
      "x-bifrost-provider": "bedrock",
      "x-bifrost-resolved-model": MODEL_ID,
      "x-amzn-requestid": "req-123",
    });
    res.end();
  });

  yield* Effect.promise(
    () =>
      new Promise<void>((resolve) => {
        server?.listen(0, "127.0.0.1", resolve);
      }),
  );
  const address = server.address();
  if (address === null || address === "" || typeof address === "string")
    throw new Error("Expected TCP test server address");
  return `http://127.0.0.1:${address.port}`;
});

describe("bedrock response headers", () => {
  it("forwards raw Smithy response headers to onResponse", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseModel = getModel("amazon-bedrock", MODEL_ID) as Model<"bedrock-converse-stream">;
        const model = { ...baseModel, baseUrl: yield* startBedrockResponseServer() };
        const responses: ProviderResponse[] = [];

        const currentTime = yield* Clock.currentTimeMillis;
        const result = yield* Effect.promise(() =>
          streamBedrock(
            model,
            normalizeContext({
              messages: [{ role: "user", content: "hello", timestamp: currentTime }],
            }),
            {
              cacheRetention: "none",
              env: { AWS_BEDROCK_FORCE_HTTP1: "1", AWS_BEDROCK_SKIP_AUTH: "1" },
              onResponse: (response) => {
                responses.push(response);
              },
            },
          ).result(),
        );

        expect(result.stopReason).toBe("error");
        expect(responses).toHaveLength(1);
        expect(responses[0]?.status).toBe(200);
        expect(responses[0]?.headers["x-amzn-requestid"]).toBe("req-123");
        expect(responses[0]?.headers["x-bifrost-provider"]).toBe("bedrock");
        expect(responses[0]?.headers["x-bifrost-resolved-model"]).toBe(MODEL_ID);
      }),
    ));
});
