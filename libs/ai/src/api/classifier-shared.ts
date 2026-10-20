import { Effect, Function } from "effect";

import modelsModule from "../models.ts";
import type typesModule from "../types.types.ts";
import headersModule from "../utils/headers.ts";
import jsonCodec from "../utils/json-codec.ts";
import providerRetry from "../utils/provider-retry.ts";
import type classifierSharedTypes from "./classifier-shared.types.ts";

const { headersToRecord, providerHeadersToRecord } = headersModule;
const { encodeJson } = jsonCodec;
const { retryProviderEffect } = providerRetry;
const { calculateCost } = modelsModule;

function httpError(
  label: string,
  response: Response,
  body: string,
): classifierSharedTypes.ClassifierHttpError {
  const error = new Error(
    `${label} returned ${response.status}`,
  ) as classifierSharedTypes.ClassifierHttpError;
  error.status = response.status;
  error.headers = response.headers;
  error.body = body;
  return error;
}

function timeoutError(timeoutMs: number): classifierSharedTypes.ClassifierHttpError {
  const error = new Error(
    `Request timed out after ${timeoutMs}ms`,
  ) as classifierSharedTypes.ClassifierHttpError;
  error.name = "TimeoutError";
  error.status = undefined;
  error.headers = undefined;
  error.body = "";
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const requiredNumber: {
  (value: unknown, field: string): (label: string) => number;
  (label: string, value: unknown, field: string): number;
} = Function.dual(3, function (label: string, value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} returned an invalid ${field}`);
  }
  return value;
});

function requestHeaders(
  model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
  apiKey: string,
  optionsHeaders?: typesModule.ProviderHeaders,
): Record<string, string> {
  return (
    providerHeadersToRecord(
      { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      model.headers,
      optionsHeaders,
    ) ?? {}
  );
}

const combineSignals = (
  signal: AbortSignal | undefined,
  timeoutSignal: AbortSignal | undefined,
): AbortSignal | undefined =>
  signal !== undefined && timeoutSignal !== undefined
    ? AbortSignal.any([signal, timeoutSignal])
    : (signal ?? timeoutSignal);

const sendClassifierRequest = (
  { label, url, model, options }: classifierSharedTypes.ClassifierRequest,
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
          body: payload,
          headers: requestHeaders(model, apiKey, options?.headers),
          method: "POST",
          signal: signal ?? null,
        }),
      );
      if (!next.ok) {
        const text = yield* Effect.promise(() => next.text());
        return yield* Effect.die(httpError(label, next, text));
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

const classifierRequest = Effect.fn("classifierRequest")(function* (
  request: classifierSharedTypes.ClassifierRequest,
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
      noRetryStatuses: request.noRetryStatuses,
      signal: options.signal,
    },
  );
  yield* Effect.promise(() =>
    Promise.resolve(
      options.onResponse?.(
        { headers: headersToRecord(response.headers), status: response.status },
        model,
      ),
    ),
  );
  return json;
});

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

const parseClassifierUsage: {
  (
    model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
  ): (value: unknown) => typesModule.Usage | undefined;
  (
    value: unknown,
    model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
  ): typesModule.Usage | undefined;
} = Function.dual(
  2,
  function (
    value: unknown,
    model: typesModule.ClassifierModel<typesModule.ClassifierApi>,
  ): typesModule.Usage | undefined {
    if (
      !isRecord(value) ||
      (value["input_tokens"] === undefined && value["output_tokens"] === undefined)
    )
      return undefined;
    const input = tokenCount(value["input_tokens"]);
    const output = tokenCount(value["output_tokens"]);
    const usage: typesModule.Usage = {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input,
      output,
      totalTokens: input + output,
    };
    calculateCost(model, usage);
    return usage;
  },
);

const classifierShared = {
  classifierRequest,
  isRecord,
  parseClassifierUsage,
  requiredNumber,
};

export default classifierShared;
