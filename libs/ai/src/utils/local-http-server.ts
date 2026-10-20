import { Deferred, Effect } from "effect";
import { serve } from "srvx";

import type localHttpServerTypes from "./local-http-server.types.ts";

const respond = (
  options: localHttpServerTypes.LocalHttpServerOptions,
  request: Request,
): Effect.Effect<Response> =>
  Effect.gen(function* () {
    const replied = yield* Deferred.make<localHttpServerTypes.LocalHttpResponse>();
    const reply = (response: localHttpServerTypes.LocalHttpResponse) =>
      Deferred.succeed(replied, response).pipe(Effect.asVoid);
    const url = new URL(request.url, options.baseUrl);
    yield* Effect.forkDetach(options.handle({ method: request.method, url }, reply));
    const { body, headers, status } = yield* Deferred.await(replied);
    return new Response(body, { headers, status });
  });

const boundPort = (url: string | undefined): number | undefined => {
  if (url === undefined) return undefined;
  const { port } = new URL(url);
  return port === "" ? undefined : Number(port);
};

const startLocalHttpServer = (
  options: localHttpServerTypes.LocalHttpServerOptions,
): Effect.Effect<localHttpServerTypes.LocalHttpServer> =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const runFork = Effect.runForkWith(yield* Effect.context<never>());
    const server = serve({
      error: (error) => {
        runFork(options.onError(error instanceof Error ? error : new Error(String(error))));
        return new Response("", { status: 500 });
      },
      fetch: (request) => runPromise(respond(options, request)),
      gracefulShutdown: false,
      hostname: options.host,
      manual: true,
      port: options.port,
      silent: true,
    });
    yield* Effect.promise(() => Promise.resolve(server.serve()).then(() => server.ready()));
    const port = boundPort(server.url);
    if (port === undefined) {
      yield* Effect.promise(() => server.close(true));
      return yield* Effect.die(new Error("Local HTTP server did not bind to TCP"));
    }
    return {
      close: Effect.promise(() => server.close(options.closeConnections)).pipe(Effect.asVoid),
      port,
    };
  });

const localHttpServer = {
  startLocalHttpServer,
};

export default localHttpServer;
