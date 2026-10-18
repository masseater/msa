import type { ChatCompletion } from "openai/resources/chat/completions.js";

import type { AssistantImages, ImageApi, ImageContent, ImageModel, TextContent } from "../types.ts";

interface OpenRouterGeneratedImage {
  image_url?: string | { url?: string };
}

type OpenRouterImageGenerationMessage = ChatCompletion["choices"][number]["message"] & {
  images?: OpenRouterGeneratedImage[];
};

function generatedImage(image: OpenRouterGeneratedImage): ImageContent | undefined {
  const imageUrl = typeof image.image_url === "string" ? image.image_url : image.image_url?.url;
  if (imageUrl?.startsWith("data:") !== true) return undefined;
  const [, mimeType, data] = imageUrl.match(/^data:([^;]+);base64,(.+)$/u) ?? [];
  if (mimeType === undefined || data === undefined) return undefined;
  return { type: "image", mimeType, data };
}

export interface ImagesResponse {
  readonly output: AssistantImages;
  readonly response: ChatCompletion;
  readonly model: ImageModel<ImageApi>;
}

export function applyImagesResponse({ output, response, model }: ImagesResponse): void {
  output.responseId = response.id;
  if (response.usage !== undefined) {
    output.usage = parseUsage(response.usage, model);
  }
  const message = response.choices[0]?.message as OpenRouterImageGenerationMessage | undefined;
  if (message === undefined) return;
  const content = message.content;
  if (typeof content === "string" && content.length > 0) {
    output.output.push({ type: "text", text: content } satisfies TextContent);
  }
  for (const image of message.images ?? []) {
    const generated = generatedImage(image);
    if (generated !== undefined) output.output.push(generated);
  }
}

function parseUsage(
  rawUsage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  },
  model: ImageModel<ImageApi>,
) {
  const promptTokens = rawUsage.prompt_tokens || 0;
  const reportedCachedTokens = rawUsage.prompt_tokens_details?.cached_tokens || 0;
  const cacheWriteTokens = rawUsage.prompt_tokens_details?.cache_write_tokens || 0;
  const cacheReadTokens =
    cacheWriteTokens > 0
      ? Math.max(0, reportedCachedTokens - cacheWriteTokens)
      : reportedCachedTokens;
  const input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
  const output = rawUsage.completion_tokens || 0;
  const usage = {
    input,
    output,
    cacheRead: cacheReadTokens,
    cacheWrite: cacheWriteTokens,
    totalTokens: input + output + cacheReadTokens + cacheWriteTokens,
    cost: {
      input: (model.cost.input / 1000000) * input,
      output: (model.cost.output / 1000000) * output,
      cacheRead: (model.cost.cacheRead / 1000000) * cacheReadTokens,
      cacheWrite: (model.cost.cacheWrite / 1000000) * cacheWriteTokens,
      total: 0,
    },
  };
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
  return usage;
}
