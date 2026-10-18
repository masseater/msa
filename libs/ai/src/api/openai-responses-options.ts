import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type { StreamOptions, Usage } from "../types.ts";

type ServiceTier = ResponseCreateParamsStreaming["service_tier"] | undefined;

export interface OpenAIResponsesStreamOptions {
  onProviderStreamEvent?: StreamOptions["onProviderStreamEvent"] | undefined;
  serviceTier?: ServiceTier;
  grammarToolInputProperties?: ReadonlyMap<string, string> | undefined;
  resolveServiceTier?: (
    responseServiceTier: ServiceTier,
    requestServiceTier: ServiceTier,
  ) => ServiceTier;
  applyServiceTierPricing?: (usage: Usage, serviceTier: ServiceTier) => void;
}

export interface ConvertResponsesToolsOptions {
  strict?: boolean | null | undefined;
  supportsStrictMode?: boolean | undefined;
  supportsOpenAIGrammarTools?: boolean | undefined;
  toolSearchResult?: boolean | undefined;
}

export interface ConvertResponsesMessagesOptions {
  includeSystemPrompt?: boolean | undefined;
  grammarToolInputProperties?: ReadonlyMap<string, string> | undefined;
  supportsMidConvoSystemMessages?: boolean | undefined;
  supportsAdditionalTools?: boolean | undefined;
  supportsToolSearch?: boolean | undefined;
  toolOptions?: ConvertResponsesToolsOptions | undefined;
  configurationUpdateEffort?: string | undefined;
}
