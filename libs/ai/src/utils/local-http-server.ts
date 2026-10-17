import { createServer } from "node:http";

import { Effect } from "effect";

export interface LocalHttpRequest {
  readonly method: string;
  readonly url: URL;
}

export interface LocalHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface LocalHttpServer {
  readonly port: number;
  readonly close: Effect.Effect<void>;
}

export interface LocalHttpServerOptions {
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly handle: (
    request: LocalHttpRequest,
    reply: (response: LocalHttpResponse) => Effect.Effect<void>,
  ) => Effect.Effect<void>;
  readonly onError: (error: Error) => Effect.Effect<void>;
  readonly closeConnections: boolean;
}

export const startLocalHttpServer = (
  options: LocalHttpServerOptions,
): Effect.Effect<LocalHttpServer> =>
  Effect.gen(function* () {
    const runFork = Effect.runForkWith(yield* Effect.context<never>());
    return yield* Effect.callback<LocalHttpServer>((resume) => {
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", options.baseUrl);
        const reply = ({ status, headers, body }: LocalHttpResponse) =>
          Effect.sync(() => {
            response.writeHead(status, { ...headers });
            response.end(body);
          });
        runFork(options.handle({ method: request.method ?? "GET", url }, reply));
      });

      const onListenError = (error: Error) => resume(Effect.die(error));
      server.once("error", onListenError);
      server.listen(options.port, options.host, () => {
        server.off("error", onListenError);
        const address = server.address();
        if (address === null || typeof address === "string") {
          server.close();
          resume(Effect.die(new Error("Local HTTP server did not bind to TCP")));
          return;
        }
        server.on("error", (error) => runFork(options.onError(error)));
        resume(
          Effect.succeed({
            port: address.port,
            close: Effect.sync(() => {
              server.close();
              if (options.closeConnections) server.closeAllConnections();
            }),
          }),
        );
      });
    });
  });
