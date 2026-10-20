import type { ThinkingLevel } from "../src/types.ts";

declare namespace openrouterReasoningOptionsTypes {
  interface OpenRouterReasoningMetadata {
    mandatory?: boolean;
    default_enabled?: boolean;
    supported_efforts?: Array<ThinkingLevel | "none">;
    default_effort?: ThinkingLevel | "none";
  }
}

export type { openrouterReasoningOptionsTypes as default };
