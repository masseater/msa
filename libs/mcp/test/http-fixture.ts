import { Effect, type Schema } from "effect";
import { dual } from "effect/Function";

import { LATEST_PROTOCOL_VERSION } from "../src/index.ts";
import { encodeJson, headersOf, listen, readMessage } from "./helpers.ts";

export interface RecordedRequest {
  method: string;
  headers: Record<string, string>;
  message?: Record<string, unknown>;
}

type FixtureEffect = Effect.Effect<Response, Schema.SchemaError>;

export type FixtureHandler = (request: Request, requests: RecordedRequest[]) => FixtureEffect;

export const startServer = Effect.fn("startServer")(function* (handler: FixtureHandler) {
  const requests: RecordedRequest[] = [];
  const origin = yield* listen((request) => handler(request, requests));
  return { url: `${origin}/mcp`, requests };
});

const answer = (value: unknown, headers: Record<string, string>) =>
  encodeJson(value).pipe(Effect.map((body) => new Response(body, { status: 200, headers })));

const initializeResult = {
  protocolVersion: LATEST_PROTOCOL_VERSION,
  capabilities: { tools: {} },
  serverInfo: { name: "http-fixture", version: "1.0.0" },
};

const respondTo = (message: Record<string, unknown>) =>
  Effect.gen(function* () {
    const id = message["id"];
    if (message["method"] === "initialize")
      return yield* answer(
        { jsonrpc: "2.0", id, result: initializeResult },
        { "content-type": "application/json", "mcp-session-id": "session-1" },
      );
    if (message["method"] === "tools/list")
      return yield* answer(
        {
          jsonrpc: "2.0",
          id,
          result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] },
        },
        { "content-type": "application/json" },
      );
    const data = yield* encodeJson({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: "hello" }] },
    });
    return new Response(`id: tool-result\ndata: ${data}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  });

const emptyWith = (status: number) => Effect.succeed(new Response(null, { status }));

const handleProtocol = (
  request: Request,
  requests: RecordedRequest[],
  body: Record<string, unknown> | undefined,
): FixtureEffect =>
  Effect.gen(function* () {
    if (request.method === "GET") {
      requests.push({ method: "GET", headers: headersOf(request) });
      return yield* emptyWith(405);
    }
    if (request.method === "DELETE") {
      requests.push({ method: "DELETE", headers: headersOf(request) });
      return yield* emptyWith(200);
    }
    const message = body ?? (yield* readMessage(request));
    requests.push({ method: request.method, headers: headersOf(request), message });
    if (!("id" in message)) return yield* emptyWith(202);
    return yield* respondTo(message);
  });

export const protocolHandler: {
  (requests: RecordedRequest[]): (request: Request) => FixtureEffect;
  (request: Request, requests: RecordedRequest[]): FixtureEffect;
} = dual(2, (request: Request, requests: RecordedRequest[]) =>
  handleProtocol(request, requests, undefined),
);

export const protocolHandlerFor =
  (message: Record<string, unknown>): FixtureHandler =>
  (request, requests) =>
    handleProtocol(request, requests, message);

export const toolsCallOnly =
  (respond: () => Response): FixtureHandler =>
  (request, requests) =>
    Effect.gen(function* () {
      if (request.method !== "POST") return yield* protocolHandler(request, requests);
      const message = yield* readMessage(request);
      if (message["method"] !== "tools/call")
        return yield* protocolHandlerFor(message)(request, requests);
      return respond();
    });
