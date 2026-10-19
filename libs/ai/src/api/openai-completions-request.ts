import { Effect } from "effect";
import type OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import type { Stream as OpenAIStream } from "openai/streaming";

import { callHook } from "../utils/hooks.ts";
import { providerRequestWithRetry } from "../utils/provider-retry.ts";
import { createClient, getClientApiKey } from "./openai-completions-client.ts";
import { buildParams } from "./openai-completions-params.ts";

interface ChatStreamResult {
  readonly data: OpenAIStream<ChatCompletionChunk>;
  readonly response: Response;
}

type RequestStreamInput = Parameters<typeof buildParams>[0];

function createRequestStream(input: RequestStreamInput): Effect.Effect<ChatStreamResult> {
  const { model, options, compat } = input;
  const apiKey = getClientApiKey({
    provider: model.provider,
    apiKey: options?.apiKey,
    headers: options?.headers,
  });
  const cacheSessionId = input.cacheRetention === "none" ? undefined : options?.sessionId;
  const client = createClient({
    model,
    apiKey,
    optionsHeaders: options?.headers,
    fetch: options?.fetch,
    sessionId: cacheSessionId,
    compat,
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

export { createRequestStream };
