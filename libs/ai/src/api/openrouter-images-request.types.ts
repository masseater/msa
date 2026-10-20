import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions.js";

import type typesModule from "../types.types.ts";

declare namespace openrouterImagesRequestTypes {
  type OpenRouterImagesCreateParams = Omit<ChatCompletionCreateParamsNonStreaming, "modalities"> & {
    modalities: Array<"image" | "text">;
  };

  interface ImagesRequest {
    readonly model: typesModule.ImageModel<typesModule.ImageApi>;
    readonly apiKey: string;
    readonly params: OpenRouterImagesCreateParams;
    readonly options: typesModule.ImagesOptions | undefined;
  }
}

export type { openrouterImagesRequestTypes as default };
