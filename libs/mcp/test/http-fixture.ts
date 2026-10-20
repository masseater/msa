import { Effect } from "effect";
import { dual } from "effect/Function";

import { LATEST_PROTOCOL_VERSION } from "../src/index.ts";
import helpers from "./helpers.ts";
import type httpFixtureTypes from "./http-fixture.types.ts";

const { encodeJson, headersOf, listen, readMessage } = helpers;

const startServer = Effect.fn("startServer")(function* (handler: httpFixtureTypes.FixtureHandler) {
  const requests: httpFixtureTypes.RecordedRequest[] = [];
  const origin = yield* listen((request) => handler(request, requests));
  return { requests, url: `${origin}/mcp` };
});

const answer = (value: unknown, headers: Record<string, string>) =>
  encodeJson(value).pipe(Effect.map((body) => new Response(body, { headers, status: 200 })));

const initializeResult = {
  capabilities: { tools: {} },
  protocolVersion: LATEST_PROTOCOL_VERSION,
  serverInfo: { name: "http-fixture", version: "1.0.0" },
};

const respondTo = (message: Record<string, unknown>) =>
  Effect.gen(function* () {
    const id = message["id"];
    if (message["method"] === "initialize")
      return yield* answer(
        { id, jsonrpc: "2.0", result: initializeResult },
        { "content-type": "application/json", "mcp-session-id": "session-1" },
      );
    if (message["method"] === "tools/list")
      return yield* answer(
        {
          id,
          jsonrpc: "2.0",
          result: { tools: [{ inputSchema: { type: "object" }, name: "echo" }] },
        },
        { "content-type": "application/json" },
      );
    const data = yield* encodeJson({
      id,
      jsonrpc: "2.0",
      result: { content: [{ text: "hello", type: "text" }] },
    });
    return new Response(`id: tool-result\ndata: ${data}\n\n`, {
      headers: { "content-type": "text/event-stream" },
      status: 200,
    });
  });

const emptyWith = (status: number) => Effect.succeed(new Response(null, { status }));

const handleProtocol = (
  request: Request,
  requests: httpFixtureTypes.RecordedRequest[],
  body: Record<string, unknown> | undefined,
): httpFixtureTypes.FixtureEffect =>
  Effect.gen(function* () {
    if (request.method === "GET") {
      requests.push({ headers: headersOf(request), method: "GET" });
      return yield* emptyWith(405);
    }
    if (request.method === "DELETE") {
      requests.push({ headers: headersOf(request), method: "DELETE" });
      return yield* emptyWith(200);
    }
    const message = body ?? (yield* readMessage(request));
    requests.push({ headers: headersOf(request), message, method: request.method });
    if (!("id" in message)) return yield* emptyWith(202);
    return yield* respondTo(message);
  });

const protocolHandler: {
  (
    requests: httpFixtureTypes.RecordedRequest[],
  ): (request: Request) => httpFixtureTypes.FixtureEffect;
  (request: Request, requests: httpFixtureTypes.RecordedRequest[]): httpFixtureTypes.FixtureEffect;
} = dual(2, (request: Request, requests: httpFixtureTypes.RecordedRequest[]) =>
  handleProtocol(request, requests, undefined),
);

const protocolHandlerFor =
  (message: Record<string, unknown>): httpFixtureTypes.FixtureHandler =>
  (request, requests) =>
    handleProtocol(request, requests, message);

const toolsCallOnly =
  (respond: () => Response): httpFixtureTypes.FixtureHandler =>
  (request, requests) =>
    Effect.gen(function* () {
      if (request.method !== "POST") return yield* protocolHandler(request, requests);
      const message = yield* readMessage(request);
      if (message["method"] !== "tools/call")
        return yield* protocolHandlerFor(message)(request, requests);
      return respond();
    });

const httpFixture = {
  protocolHandler,
  protocolHandlerFor,
  startServer,
  toolsCallOnly,
};

export default httpFixture;
