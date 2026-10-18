import { Effect, Function } from "effect";

import { calculateCost } from "../models.ts";
import type {
  ClassifierApi,
  ClassifierModel,
  ClassifierOptions,
  ProviderHeaders,
  Usage,
} from "../types.ts";
import { headersToRecord, providerHeadersToRecord } from "../utils/headers.ts";
import { encodeJson } from "../utils/json-codec.ts";
import { retryProviderEffect } from "../utils/provider-retry.ts";

export interface ClassifierHttpError extends Error {
  status: number | undefined;
  headers: Headers | undefined;
  body: string;
}

function httpError(label: string, response: Response, body: string): ClassifierHttpError {
  const error = new Error(`${label} returned ${response.status}`) as ClassifierHttpError;
  error.status = response.status;
  error.headers = response.headers;
  error.body = body;
  return error;
}

function timeoutError(timeoutMs: number): ClassifierHttpError {
  const error = new Error(`Request timed out after ${timeoutMs}ms`) as ClassifierHttpError;
  error.name = "TimeoutError";
  error.status = undefined;
  error.headers = undefined;
  error.body = "";
  return error;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const requiredNumber: {
  (value: unknown, field: string): (label: string) => number;
  (label: string, value: unknown, field: string): number;
} = Function.dual(3, function (label: string, value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} returned an invalid ${field}`);
  }
  return value;
});

function requestHeaders(
  model: ClassifierModel<ClassifierApi>,
  apiKey: string,
  optionsHeaders?: ProviderHeaders,
): Record<string, string> {
  return (
    providerHeadersToRecord(
      { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      model.headers,
      optionsHeaders,
    ) ?? {}
  );
}

export interface ClassifierRequest {
  readonly label: string;
  readonly url: URL;
  readonly model: ClassifierModel<ClassifierApi>;
  readonly body: unknown;
  readonly options: ClassifierOptions | undefined;
  readonly noRetryStatuses?: readonly number[] | undefined;
}

const combineSignals = (
  signal: AbortSignal | undefined,
  timeoutSignal: AbortSignal | undefined,
): AbortSignal | undefined =>
  signal !== undefined && timeoutSignal !== undefined
    ? AbortSignal.any([signal, timeoutSignal])
    : (signal ?? timeoutSignal);

const sendClassifierRequest = (
  { label, url, model, options }: ClassifierRequest,
  apiKey: string,
  payload: string,
) =>
  Effect.suspend(() => {
    const timeoutSignal =
      options?.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs);
    const signal = combineSignals(options?.signal, timeoutSignal);
    const requestFetch = options?.fetch ?? globalThis.fetch;
    return Effect.gen(function* () {
      const next = yield* Effect.promise(() =>
        requestFetch(url, {
          method: "POST",
          headers: requestHeaders(model, apiKey, options?.headers),
          body: payload,
          signal: signal ?? null,
        }),
      );
      if (!next.ok) {
        const text = yield* Effect.promise(() => next.text());
        return yield* Effect.die(httpError(label, next, text));
      }
      const json: unknown = yield* Effect.promise((): Promise<unknown> => next.json());
      return { response: next, json };
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

export const classifierRequest = Effect.fn("classifierRequest")(function* (
  request: ClassifierRequest,
) {
  const { model, options } = request;
  if (options?.apiKey === undefined || options?.apiKey === "")
    return yield* Effect.die(new Error(`No API key for provider: ${model.provider}`));
  const apiKey = options.apiKey;
  const transformed = yield* Effect.promise(() =>
    Promise.resolve(options.onPayload?.(request.body, model)),
  );
  const payload = yield* encodeJson(transformed === undefined ? request.body : transformed);
  const { response, json } = yield* retryProviderEffect(
    sendClassifierRequest(request, apiKey, payload),
    {
      maxRetries: options.maxRetries ?? 2,
      maxRetryDelayMs: options.maxRetryDelayMs,
      signal: options.signal,
      noRetryStatuses: request.noRetryStatuses,
    },
  );
  yield* Effect.promise(() =>
    Promise.resolve(
      options.onResponse?.(
        { status: response.status, headers: headersToRecord(response.headers) },
        model,
      ),
    ),
  );
  return json;
});

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export const parseClassifierUsage: {
  (model: ClassifierModel<ClassifierApi>): (value: unknown) => Usage | undefined;
  (value: unknown, model: ClassifierModel<ClassifierApi>): Usage | undefined;
} = Function.dual(2, function (value: unknown, model: ClassifierModel<ClassifierApi>):
  | Usage
  | undefined {
  if (
    !isRecord(value) ||
    (value["input_tokens"] === undefined && value["output_tokens"] === undefined)
  )
    return undefined;
  const input = tokenCount(value["input_tokens"]);
  const output = tokenCount(value["output_tokens"]);
  const usage: Usage = {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  calculateCost(model, usage);
  return usage;
});
