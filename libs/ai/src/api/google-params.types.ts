import type typesModule from "../types.types.ts";
import type googleThinkingTypes from "./google-thinking.types.ts";

declare namespace googleParamsTypes {
  interface GoogleRequestOptions extends typesModule.StreamOptions {
    toolChoice?: "auto" | "none" | "any" | undefined;
    thinking?: {
      enabled: boolean;
      budgetTokens?: number;
      level?: googleThinkingTypes.GoogleApiThinkingLevel;
    };
  }

  interface GoogleParamsRequest<T extends googleThinkingTypes.GoogleApiType> {
    readonly model: typesModule.Model<T>;
    readonly context: typesModule.TranscriptContext;
    readonly options: GoogleRequestOptions | undefined;
  }
}

export type { googleParamsTypes as default };
