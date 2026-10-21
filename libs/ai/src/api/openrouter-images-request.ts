import { Effect } from "effect";
import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionContentPart,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions.js";

import type typesModule from "../types.types.ts";
import headersModule from "../utils/headers.ts";
import providerRetry from "../utils/provider-retry.ts";
import sanitizeUnicode from "../utils/sanitize-unicode.ts";
import type openrouterImagesRequestTypes from "./openrouter-images-request.types.ts";

const { sanitizeSurrogates } = sanitizeUnicode;
const { providerHeadersToRecord } = headersModule;
const { providerRequestWithRetry } = providerRetry;

function buildParams({
  model,
  context,
}: {
  readonly model: typesModule.ImageModel<typesModule.ImageApi>;
  readonly context: typesModule.ImagesContext;
}): openrouterImagesRequestTypes.OpenRouterImagesCreateParams {
  const content: ChatCompletionContentPart[] = context.input.map(
    (item): ChatCompletionContentPart => {
      if (item.type === "text") {
        return {
          text: sanitizeSurrogates(item.text),
          type: "text",
        } satisfies ChatCompletionContentPartText;
      }
      return {
        image_url: {
          url: `data:${item.mimeType};base64,${item.data}`,
        },
        type: "image_url",
      } satisfies ChatCompletionContentPartImage;
    },
  );

  return {
    messages: [
      {
        content,
        role: "user" as const,
      },
    ],
    modalities: model.output.includes("text") ? ["image", "text"] : ["image"],
    model: model.id,
    stream: false,
  };
}

function createClient(
  model: typesModule.ImageModel<typesModule.ImageApi>,
  apiKey: string,
  options?: typesModule.ImagesOptions,
): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders: providerHeadersToRecord({ ...model.headers, ...options?.headers }),
    fetch: options?.fetch,
  });
}

function requestImages({
  model,
  apiKey,
  params,
  options,
}: openrouterImagesRequestTypes.ImagesRequest): Effect.Effect<{
  data: ChatCompletion;
  response: Response;
}> {
  const client = createClient(model, apiKey, options);
  const requestOptions = {
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    maxRetries: 0,
  };
  return providerRequestWithRetry(
    () =>
      client.chat.completions
        .create(params as unknown as ChatCompletionCreateParamsNonStreaming, requestOptions)
        .withResponse(),
    {
      maxRetries: options?.maxRetries,
      maxRetryDelayMs: options?.maxRetryDelayMs,
      signal: options?.signal,
    },
  );
}

const openrouterImagesRequest = {
  buildParams,
  requestImages,
};

export default openrouterImagesRequest;
