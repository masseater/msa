import type typesModule from "../types.types.ts";

declare namespace fauxUsageTypes {
  interface UsageEstimateRequest {
    readonly message: typesModule.AssistantMessage;
    readonly context: typesModule.TranscriptContext;
    readonly options: typesModule.StreamOptions | undefined;
    readonly promptCache: Map<string, readonly string[]>;
  }
}

export type { fauxUsageTypes as default };
