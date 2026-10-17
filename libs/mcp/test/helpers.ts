import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { Cause, Data, Effect, Schema } from "effect";

export type HttpRequest = IncomingMessage;
export type HttpResponse = ServerResponse;

export type HttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  origin: string,
) => Effect.Effect<void, Schema.SchemaError>;

class HttpTestError extends Data.TaggedError("HttpTestError")<{ readonly message: string }> {}

const servers: Server[] = [];

export const send = (request: Request): Promise<Response> => fetch(request);

export const readBody = (request: IncomingMessage): Effect.Effect<string> =>
  Effect.callback<string>((resume) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resume(Effect.succeed(Buffer.concat(chunks).toString("utf8"))));
    request.on("error", (error) => resume(Effect.die(error)));
  });

const decodeMessage = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

export const readMessage = (request: IncomingMessage) =>
  readBody(request).pipe(Effect.flatMap(decodeMessage));

const encodeJsonString = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export const encodeJson = (value: unknown): Effect.Effect<string, Schema.SchemaError> =>
  encodeJsonString(value);

const failWith = (response: ServerResponse) => (cause: Cause.Cause<Schema.SchemaError>) =>
  Effect.sync(() => {
    response.statusCode = 500;
    response.end(String(Cause.squash(cause)));
  });

export const listen = Effect.fn("listen")(function* (handler: HttpHandler) {
  const context = yield* Effect.context();
  const state = { origin: "" };
  const server = createServer((request, response) => {
    Effect.runForkWith(context)(
      handler(request, response, state.origin).pipe(Effect.catchCause(failWith(response))),
    );
  });
  yield* Effect.callback<void>((resume) => {
    server.listen(0, "127.0.0.1", () => resume(Effect.void));
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    return yield* new HttpTestError({ message: "HTTP test server did not bind to TCP" });
  state.origin = `http://127.0.0.1:${address.port}`;
  servers.push(server);
  return state.origin;
});

const closeServer = (server: Server): Effect.Effect<void, Error> =>
  Effect.callback<void, Error>((resume) => {
    server.closeAllConnections();
    server.close((error) => resume(error === undefined ? Effect.void : Effect.fail(error)));
  });

export const closeServers: Effect.Effect<void, Error> = Effect.suspend(() =>
  Effect.forEach(servers.splice(0), closeServer, { concurrency: "unbounded", discard: true }),
);
