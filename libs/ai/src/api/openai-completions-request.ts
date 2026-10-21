import { Effect } from "effect";
import type OpenAI from "openai";

import hooks from "../utils/hooks.ts";
import providerRetry from "../utils/provider-retry.ts";
import openaiCompletionsClient from "./openai-completions-client.ts";
import openaiCompletionsParams from "./openai-completions-params.ts";
import type openaiCompletionsRequestTypes from "./openai-completions-request.types.ts";

const { buildParams } = openaiCompletionsParams;
const { createClient, getClientApiKey } = openaiCompletionsClient;
const { callHook } = hooks;
const { providerRequestWithRetry } = providerRetry;
type RequestStreamInput = Parameters<typeof buildParams>[0];

function createRequestStream(
  input: RequestStreamInput,
): Effect.Effect<openaiCompletionsRequestTypes.ChatStreamResult> {
  const { model, options, compat } = input;
  const apiKey = getClientApiKey({
    apiKey: options?.apiKey,
    headers: options?.headers,
    provider: model.provider,
  });
  const cacheSessionId = input.cacheRetention === "none" ? undefined : options?.sessionId;
  const client = createClient({
    apiKey,
    compat,
    fetch: options?.fetch,
    model,
    optionsHeaders: options?.headers,
    sessionId: cacheSessionId,
  });
  return Effect.gen(function* () {
    let params = buildParams(input);
    const nextParams = yield* callHook(() => options?.onPayload?.(params, model));
    if (nextParams !== undefined) {
      params = nextParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
    }
    const requestOptions = {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      maxRetries: 0,
    };
    return yield* providerRequestWithRetry(
      () => client.chat.completions.create(params, requestOptions).withResponse(),
      {
        maxRetries: options?.maxRetries,
        maxRetryDelayMs: options?.maxRetryDelayMs,
        signal: options?.signal,
      },
    );
  });
}

const openaiCompletionsRequest = {
  createRequestStream,
};

export default openaiCompletionsRequest;
