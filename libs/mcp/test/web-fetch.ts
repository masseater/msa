import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, ManagedRuntime, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

const runtime = ManagedRuntime.make(
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- HttpClient (effect/unstable) is the only Effect HTTP client
  NodeHttpClient.layerUndici,
);

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

export const webFetch = (request: Request): Promise<Response> =>
  runtime.runPromise(
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- HttpClient (effect/unstable) is the only Effect HTTP client
    HttpClient.execute(HttpClientRequest.fromWeb(request)).pipe(
      Effect.map(
        (response) =>
          new Response(
            NULL_BODY_STATUSES.has(response.status)
              ? null
              : Stream.toReadableStream(response.stream),
            { status: response.status, headers: response.headers },
          ),
      ),
    ),
    { signal: request.signal },
  );
