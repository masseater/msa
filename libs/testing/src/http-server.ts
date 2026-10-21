import { Cause, Deferred, Effect, Exit, Schema, Scope } from "effect";
import { type Server, serve } from "srvx";

import type httpServerTypes from "./http-server.types.ts";

interface Running {
  scope: Scope.Closeable;
  closing: Deferred.Deferred<void>;
}

const running: Running[] = [];
const openBodies = new Set<AbortController>();

const readBody = (request: Request): Effect.Effect<string> => Effect.promise(() => request.text());

const decodeMessage = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

const readMessage = (
  request: Request,
): Effect.Effect<{ readonly [key: string]: unknown }, Schema.SchemaError> =>
  readBody(request).pipe(Effect.flatMap(decodeMessage));

const encodeJsonString = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const encodeJson = (value: unknown): Effect.Effect<string, Schema.SchemaError> =>
  encodeJsonString(value);

const headersOf = (request: Request): Record<string, string> => Object.fromEntries(request.headers);

const openStream = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start: (controller) => controller.enqueue(new TextEncoder().encode(text)),
  });

const failWith = (cause: Cause.Cause<Schema.SchemaError>) =>
  Effect.succeed(new Response(String(Cause.squash(cause)), { status: 500 }));

const tracked = (response: Response): Response => {
  if (response.body === null) return response;
  const controller = new AbortController();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  openBodies.add(controller);
  void response.body
    .pipeTo(writable, { signal: controller.signal })
    .catch(() => undefined)
    .finally(() => openBodies.delete(controller));
  return new Response(readable, response);
};

const unavailable = (closing: Deferred.Deferred<void>) =>
  Deferred.await(closing).pipe(Effect.as(new Response(null, { status: 503 })));

const respondWith =
  (handler: httpServerTypes.HttpHandler, origin: { value: string }, server: Running) =>
  (request: Request): Promise<Response> =>
    Effect.runPromise(
      handler(request, origin.value).pipe(
        Effect.catchCause(failWith),
        Effect.raceFirst(unavailable(server.closing)),
        Effect.map(tracked),
      ),
    );

const startLoopback = (fetch: (request: Request) => Promise<Response>): Effect.Effect<Server> =>
  Effect.promise(() => {
    const server = serve({
      fetch,
      gracefulShutdown: false,
      hostname: "127.0.0.1",
      manual: true,
      port: 0,
      silent: true,
    });
    return Promise.resolve(server.serve()).then(() => server);
  });

const originOf = (server: Server): Effect.Effect<string> =>
  server.url === undefined
    ? Effect.die(new Error("HTTP test server did not bind to TCP"))
    : Effect.succeed(`http://127.0.0.1:${new URL(server.url).port}`);

const serveLoopback = (
  fetch: (request: Request) => Promise<Response>,
): Effect.Effect<string, never, Scope.Scope> =>
  Effect.acquireRelease(startLoopback(fetch), (server) =>
    Effect.promise(() => server.close(true)),
  ).pipe(Effect.flatMap(originOf));

const listen = Effect.fn("listen")(function* (
  handler: httpServerTypes.HttpHandler,
): Effect.fn.Return<string> {
  const server: Running = { closing: Deferred.makeUnsafe<void>(), scope: yield* Scope.make() };
  running.push(server);
  const origin = { value: "" };
  origin.value = yield* serveLoopback(respondWith(handler, origin, server)).pipe(
    Scope.provide(server.scope),
  );
  return origin.value;
});

const closeServers: Effect.Effect<void> = Effect.suspend(() => {
  for (const controller of openBodies) controller.abort();
  openBodies.clear();
  const servers = running.splice(0);
  for (const server of servers) Deferred.doneUnsafe(server.closing, Exit.void);
  return Effect.forEach(servers, (server) => Scope.close(server.scope, Exit.void), {
    concurrency: "unbounded",
    discard: true,
  });
});

const httpServer = {
  closeServers,
  encodeJson,
  headersOf,
  listen,
  openStream,
  readBody,
  readMessage,
  serveLoopback,
};

export default httpServer;
