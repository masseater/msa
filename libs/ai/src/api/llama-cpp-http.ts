import { Effect } from "effect";

import headersModule from "../utils/headers.ts";
import jsonCodec from "../utils/json-codec.ts";
import providerRetry from "../utils/provider-retry.ts";
import type llamaCppHttpTypes from "./llama-cpp-http.types.ts";
import llamaCppPrompt from "./llama-cpp-prompt.ts";

const { LABEL } = llamaCppPrompt;
const { headersToRecord, providerHeadersToRecord } = headersModule;
const { encodeJson } = jsonCodec;
const { retryProviderEffect } = providerRetry;

interface HttpError extends Error {
  status: number | undefined;
  headers: Headers | undefined;
  body: string;
}

function httpError(response: Response, body: string): HttpError {
  const error = new Error(`${LABEL} returned ${response.status}`) as HttpError;
  error.status = response.status;
  error.headers = response.headers;
  error.body = body;
  return error;
}

function timeoutError(timeoutMs: number): HttpError {
  const error = new Error(`Request timed out after ${timeoutMs}ms`) as HttpError;
  error.name = "TimeoutError";
  error.status = undefined;
  error.headers = undefined;
  error.body = "";
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function llamaServerRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, "").replace(/\/v1$/u, "");
}

const observePayload = (
  request: llamaCppHttpTypes.RequestContext,
  body: unknown,
): Effect.Effect<unknown> =>
  Effect.promise(() => Promise.resolve(request.options?.onPayload?.(body, request.model))).pipe(
    Effect.map((transformed) => (transformed === undefined ? body : transformed)),
  );

const requestHeaders = ({
  model,
  options,
}: llamaCppHttpTypes.RequestContext): Record<string, string> =>
  providerHeadersToRecord(
    {
      "content-type": "application/json",
      ...(options?.apiKey !== undefined && options?.apiKey !== ""
        ? { authorization: `Bearer ${options.apiKey}` }
        : {}),
    },
    model.headers,
    options?.headers,
  ) ?? {};

const sendOnce = (request: llamaCppHttpTypes.RequestContext, url: string, payload: string) =>
  Effect.suspend(() => {
    const { options } = request;
    const timeoutSignal =
      options?.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs);
    const signal =
      options?.signal !== undefined && timeoutSignal !== undefined
        ? AbortSignal.any([options.signal, timeoutSignal])
        : (options?.signal ?? timeoutSignal);
    const requestFetch = options?.fetch ?? globalThis.fetch;
    return Effect.gen(function* () {
      const next = yield* Effect.promise(() =>
        requestFetch(url, {
          body: payload,
          headers: requestHeaders(request),
          method: "POST",
          signal: signal ?? null,
        }),
      );
      if (!next.ok) {
        const text = yield* Effect.promise(() => next.text());
        return yield* Effect.die(httpError(next, text));
      }
      const json: unknown = yield* Effect.promise((): Promise<unknown> => next.json());
      return { json, response: next };
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.die(
          timeoutSignal?.aborted === true && options?.signal?.aborted !== true
            ? timeoutError(options?.timeoutMs ?? 0)
            : error,
        ),
      ),
    );
  });

interface PostRequest {
  readonly path: string;
  readonly body: unknown;
  readonly observe: boolean;
}

const post = Effect.fn("post")(function* (
  request: llamaCppHttpTypes.RequestContext,
  { path, body, observe }: PostRequest,
) {
  const { model, root, options } = request;
  const payload = yield* encodeJson(observe ? yield* observePayload(request, body) : body);
  const { response, json } = yield* retryProviderEffect(
    sendOnce(request, `${root}${path}`, payload),
    {
      maxRetries: options?.maxRetries ?? 2,
      maxRetryDelayMs: options?.maxRetryDelayMs,
      signal: options?.signal,
    },
  );
  if (observe) {
    yield* Effect.promise(() =>
      Promise.resolve(
        options?.onResponse?.(
          { headers: headersToRecord(response.headers), status: response.status },
          model,
        ),
      ),
    );
  }
  return json;
});

const llamaCppHttp = {
  httpError,
  isRecord,
  llamaServerRoot,
  observePayload,
  post,
  requestHeaders,
  sendOnce,
  timeoutError,
};

export default llamaCppHttp;
