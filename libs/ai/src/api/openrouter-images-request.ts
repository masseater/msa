import { Effect } from "effect";
import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionContentPart,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions.js";

import type { ImageApi, ImageModel, ImagesContext, ImagesOptions } from "../types.ts";
import { providerHeadersToRecord } from "../utils/headers.ts";
import { providerRequestWithRetry } from "../utils/provider-retry.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";

export type OpenRouterImagesCreateParams = Omit<
  ChatCompletionCreateParamsNonStreaming,
  "modalities"
> & {
  modalities: Array<"image" | "text">;
};

export function buildParams({
  model,
  context,
}: {
  readonly model: ImageModel<ImageApi>;
  readonly context: ImagesContext;
}): OpenRouterImagesCreateParams {
  const content: ChatCompletionContentPart[] = context.input.map(
    (item): ChatCompletionContentPart => {
      if (item.type === "text") {
        return {
          type: "text",
          text: sanitizeSurrogates(item.text),
        } satisfies ChatCompletionContentPartText;
      }
      return {
        type: "image_url",
        image_url: {
          url: `data:${item.mimeType};base64,${item.data}`,
        },
      } satisfies ChatCompletionContentPartImage;
    },
  );

  return {
    model: model.id,
    messages: [
      {
        role: "user" as const,
        content,
      },
    ],
    stream: false,
    modalities: model.output.includes("text") ? ["image", "text"] : ["image"],
  };
}

function createClient(
  model: ImageModel<ImageApi>,
  apiKey: string,
  options?: ImagesOptions,
): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    fetch: options?.fetch,
    defaultHeaders: providerHeadersToRecord({ ...model.headers, ...options?.headers }),
  });
}

export interface ImagesRequest {
  readonly model: ImageModel<ImageApi>;
  readonly apiKey: string;
  readonly params: OpenRouterImagesCreateParams;
  readonly options: ImagesOptions | undefined;
}

export function requestImages({
  model,
  apiKey,
  params,
  options,
}: ImagesRequest): Effect.Effect<{ data: ChatCompletion; response: Response }> {
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
