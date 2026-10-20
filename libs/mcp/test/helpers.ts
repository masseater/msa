import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Cause, Context, Data, Deferred, Effect, Exit, Layer, Schema, Scope } from "effect";
import { HttpEffect, HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";

import type helpersTypes from "./helpers.types.ts";

class HttpTestError extends Data.TaggedError("HttpTestError")<{ readonly message: string }> {}

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

const readMessage = (request: Request) => readBody(request).pipe(Effect.flatMap(decodeMessage));

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

const respondWith = (
  handler: helpersTypes.HttpHandler,
  origin: { value: string },
  server: Running,
) =>
  HttpEffect.fromWebHandler((request) =>
    Effect.runPromise(
      handler(request, origin.value).pipe(
        Effect.catchCause(failWith),
        Effect.raceFirst(unavailable(server.closing)),
        Effect.map(tracked),
      ),
    ),
  );

const serveIn = (server: Running, handler: helpersTypes.HttpHandler) =>
  Effect.gen(function* () {
    const origin = { value: "" };
    const serving = HttpServer.serve(respondWith(handler, origin, server)).pipe(
      Layer.provideMerge(NodeHttpServer.layerTest),
    );
    const services = yield* Layer.buildWithScope(serving, server.scope).pipe(
      Effect.mapError((error) => new HttpTestError({ message: error.message })),
    );
    const { address } = Context.get(services, HttpServer.HttpServer);
    if (NetAddress.isUnixPathAddress(address))
      return yield* new HttpTestError({ message: "HTTP test server did not bind to TCP" });
    origin.value = `http://127.0.0.1:${address.port}`;
    return origin.value;
  });

const listen = Effect.fn("listen")(function* (handler: helpersTypes.HttpHandler) {
  const server: Running = { closing: Deferred.makeUnsafe<void>(), scope: yield* Scope.make() };
  running.push(server);
  return yield* serveIn(server, handler);
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

const helpers = {
  closeServers,
  encodeJson,
  headersOf,
  listen,
  openStream,
  readBody,
  readMessage,
};

export default helpers;
