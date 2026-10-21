import type typesModule from "../types.types.ts";

declare namespace openaiResponsesToolIdsTypes {
  interface ToolCallIdScope<TApi extends typesModule.Api> {
    readonly model: typesModule.Model<TApi>;
    readonly allowedToolCallProviders: ReadonlySet<string>;
  }
}

export type { openaiResponsesToolIdsTypes as default };
