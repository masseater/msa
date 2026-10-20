import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

import type typesModule from "../types.types.ts";
import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";

declare namespace openaiCompletionsConvertStateTypes {
  type KimiToolSystemMessageParam = {
    role: "system";
    tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  };

  interface ConvertCompletionsMessagesOptions {
    grammarToolInputProperties?: ReadonlyMap<string, string>;
  }

  type ImageUrlPart = { type: "image_url"; image_url: { url: string } };

  interface ConvertState {
    readonly model: typesModule.Model<"openai-completions">;
    readonly compat: openaiCompletionsTypesModule.ResolvedOpenAICompletionsCompat;
    readonly options: ConvertCompletionsMessagesOptions | undefined;
    readonly instructionRole: "developer" | "system";
    readonly anchorsAdditions: boolean;
    readonly params: ChatCompletionMessageParam[];
    lastRole: string | null;
  }
}

export type { openaiCompletionsConvertStateTypes as default };
