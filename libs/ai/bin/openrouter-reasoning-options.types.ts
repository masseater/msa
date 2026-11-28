import type typesModule from "../src/types.types.ts";

declare namespace openrouterReasoningOptionsTypes {
  interface OpenRouterReasoningMetadata {
    mandatory?: boolean;
    default_enabled?: boolean;
    supported_efforts?: Array<typesModule.ThinkingLevel | "none">;
    default_effort?: typesModule.ThinkingLevel | "none";
  }
}

export type { openrouterReasoningOptionsTypes as default };
