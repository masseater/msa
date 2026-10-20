import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";

declare namespace openaiResponsesOptionsTypes {
  type ServiceTier = ResponseCreateParamsStreaming["service_tier"] | undefined;

  interface OpenAIResponsesStreamOptions {
    onProviderStreamEvent?: typesModule.StreamOptions["onProviderStreamEvent"] | undefined;
    serviceTier?: ServiceTier;
    grammarToolInputProperties?: ReadonlyMap<string, string> | undefined;
    resolveServiceTier?: (
      responseServiceTier: ServiceTier,
      requestServiceTier: ServiceTier,
    ) => ServiceTier;
    applyServiceTierPricing?: (usage: typesModule.Usage, serviceTier: ServiceTier) => void;
  }

  interface ConvertResponsesToolsOptions {
    strict?: boolean | null | undefined;
    supportsStrictMode?: boolean | undefined;
    supportsOpenAIGrammarTools?: boolean | undefined;
    toolSearchResult?: boolean | undefined;
  }

  interface ConvertResponsesMessagesOptions {
    includeSystemPrompt?: boolean | undefined;
    grammarToolInputProperties?: ReadonlyMap<string, string> | undefined;
    supportsMidConvoSystemMessages?: boolean | undefined;
    supportsAdditionalTools?: boolean | undefined;
    supportsToolSearch?: boolean | undefined;
    toolOptions?: ConvertResponsesToolsOptions | undefined;
    configurationUpdateEffort?: string | undefined;
  }
}

export type { openaiResponsesOptionsTypes as default };
