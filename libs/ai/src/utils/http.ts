import { Effect, Layer, Tracer } from "effect";
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/http";

import { dieOnAbort } from "./abort.ts";

export interface HttpRequest {
  readonly url: string | URL;
  readonly method?: "GET" | "POST" | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly body?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface HttpReply {
  readonly status: number;
  readonly ok: boolean;
  readonly header: (name: string) => string | undefined;
  readonly text: Effect.Effect<string>;
  readonly json: Effect.Effect<unknown>;
}

const globalFetch = (): typeof globalThis.fetch => globalThis.fetch;

const forwardToGlobalFetch: typeof globalThis.fetch = (input, init) => globalFetch()(input, init);

const httpLayer = Layer.mergeAll(
  Layer.succeed(Tracer.DisablePropagation, true),
  FetchHttpClient.layer,
  Layer.succeed(FetchHttpClient.Fetch, forwardToGlobalFetch),
);

const buildRequest = (request: HttpRequest) => {
  const url = request.url instanceof URL ? request.url.href : request.url;
  const base = request.method === "POST" ? HttpClientRequest.post(url) : HttpClientRequest.get(url);
  const withHeaders = HttpClientRequest.setHeaders(base, request.headers ?? {});
  const body = request.body;
  if (body === undefined) return withHeaders;
  const contentType = Object.entries(request.headers ?? {}).find(
    ([name]) => name.toLowerCase() === "content-type",
  )?.[1];
  return HttpClientRequest.setBody(withHeaders, HttpBody.raw(body, { contentType }));
};

const send = (request: HttpRequest) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const execute = Effect.orDie(client.execute(buildRequest(request)));
    const signal = request.signal;
    const response = yield* signal === undefined
      ? execute
      : Effect.raceFirst(
          execute,
          dieOnAbort(signal, (aborted) => aborted.reason),
        );
    const headers = response.headers;
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      header: (name: string) => headers[name.toLowerCase()],
      text: Effect.orDie(response.text),
      json: Effect.orDie(Effect.map(response.json, (value): unknown => value)),
    } satisfies HttpReply;
  });

export const httpRequest = (request: HttpRequest): Effect.Effect<HttpReply> =>
  Effect.scoped(
    Effect.flatMap(Layer.build(httpLayer), (services) =>
      Effect.provideContext(send(request), services),
    ),
  );

export const fetchReply = (request: HttpRequest): Promise<HttpReply> =>
  Effect.runPromise(httpRequest(request));
