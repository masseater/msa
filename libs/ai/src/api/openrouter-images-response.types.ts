import type { ChatCompletion } from "openai/resources/chat/completions.js";

import type typesModule from "../types.types.ts";

declare namespace openrouterImagesResponseTypes {
  interface ImagesResponse {
    readonly output: typesModule.AssistantImages;
    readonly response: ChatCompletion;
    readonly model: typesModule.ImageModel<typesModule.ImageApi>;
  }
}

export type { openrouterImagesResponseTypes as default };
