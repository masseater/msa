import type typesModule from "../types.types.ts";

declare namespace googleThinkingTypes {
  type GoogleApiType = "google-generative-ai";

  type GoogleApiThinkingLevel =
    | "THINKING_LEVEL_UNSPECIFIED"
    | "MINIMAL"
    | "LOW"
    | "MEDIUM"
    | "HIGH";

  type ResolvedGoogleThinkingLevel = Exclude<typesModule.ThinkingLevel, "xhigh" | "max">;
}

export type { googleThinkingTypes as default };
