import type typesModule from "../types.types.ts";

declare namespace fauxMessagesTypes {
  type FauxContentBlock =
    | typesModule.TextContent
    | typesModule.ThinkingContent
    | typesModule.ToolCall;

  interface FauxOrigin {
    readonly api: string;
    readonly provider: string;
    readonly modelId: string;
  }
}

export type { fauxMessagesTypes as default };
