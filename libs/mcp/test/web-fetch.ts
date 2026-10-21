import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, ManagedRuntime, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

const runtime = ManagedRuntime.make(NodeHttpClient.layerUndici);

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

const webFetch = (request: Request): Promise<Response> =>
  runtime.runPromise(
    HttpClient.execute(HttpClientRequest.fromWeb(request)).pipe(
      Effect.map(
        (response) =>
          new Response(
            NULL_BODY_STATUSES.has(response.status)
              ? null
              : Stream.toReadableStream(response.stream),
            { headers: response.headers, status: response.status },
          ),
      ),
    ),
    { signal: request.signal },
  );

export default webFetch;
