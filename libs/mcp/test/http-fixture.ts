import { Effect, type Schema } from "effect";
import { dual } from "effect/Function";

import { LATEST_PROTOCOL_VERSION } from "../src/index.ts";
import { encodeJson, type HttpRequest, type HttpResponse, listen, readMessage } from "./helpers.ts";

export interface RecordedRequest {
  method: string;
  headers: HttpRequest["headers"];
  message?: Record<string, unknown>;
}

type FixtureEffect = Effect.Effect<void, Schema.SchemaError>;

export type FixtureHandler = (
  request: HttpRequest,
  response: HttpResponse,
  requests: RecordedRequest[],
) => FixtureEffect;

export const startServer = Effect.fn("startServer")(function* (handler: FixtureHandler) {
  const requests: RecordedRequest[] = [];
  const origin = yield* listen((request, response) => handler(request, response, requests));
  return { url: `${origin}/mcp`, requests };
});

const answer = (response: HttpResponse, value: unknown, headers: Record<string, string>) =>
  Effect.gen(function* () {
    const body = yield* encodeJson(value);
    response.writeHead(200, headers);
    response.end(body);
  });

const initializeResult = {
  protocolVersion: LATEST_PROTOCOL_VERSION,
  capabilities: { tools: {} },
  serverInfo: { name: "http-fixture", version: "1.0.0" },
};

const respondTo = (response: HttpResponse, message: Record<string, unknown>) =>
  Effect.gen(function* () {
    const id = message["id"];
    if (message["method"] === "initialize")
      return yield* answer(
        response,
        { jsonrpc: "2.0", id, result: initializeResult },
        { "content-type": "application/json", "mcp-session-id": "session-1" },
      );
    if (message["method"] === "tools/list")
      return yield* answer(
        response,
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
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("id: tool-result\n");
    response.end(`data: ${data}\n\n`);
  });

const endWith = (response: HttpResponse, status: number) =>
  Effect.sync(() => {
    response.statusCode = status;
    response.end();
  });

const handleProtocol = (
  request: HttpRequest,
  response: HttpResponse,
  requests: RecordedRequest[],
  body: Record<string, unknown> | undefined,
): FixtureEffect =>
  Effect.gen(function* () {
    if (request.method === "GET") {
      requests.push({ method: "GET", headers: request.headers });
      return yield* endWith(response, 405);
    }
    if (request.method === "DELETE") {
      requests.push({ method: "DELETE", headers: request.headers });
      return yield* endWith(response, 200);
    }
    const message = body ?? (yield* readMessage(request));
    requests.push({ method: request.method ?? "", headers: request.headers, message });
    if (!("id" in message)) return yield* endWith(response, 202);
    yield* respondTo(response, message);
  });

export const protocolHandler: {
  (response: HttpResponse, requests: RecordedRequest[]): (request: HttpRequest) => FixtureEffect;
  (request: HttpRequest, response: HttpResponse, requests: RecordedRequest[]): FixtureEffect;
} = dual(3, (request: HttpRequest, response: HttpResponse, requests: RecordedRequest[]) =>
  handleProtocol(request, response, requests, undefined),
);

export const protocolHandlerFor =
  (message: Record<string, unknown>): FixtureHandler =>
  (request, response, requests) =>
    handleProtocol(request, response, requests, message);

export const toolsCallOnly =
  (respond: (response: HttpResponse) => void): FixtureHandler =>
  (request, response, requests) =>
    Effect.gen(function* () {
      if (request.method !== "POST") return yield* protocolHandler(request, response, requests);
      const message = yield* readMessage(request);
      if (message["method"] !== "tools/call")
        return yield* protocolHandlerFor(message)(request, response, requests);
      respond(response);
    });
