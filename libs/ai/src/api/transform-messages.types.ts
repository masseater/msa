import type typesModule from "../types.types.ts";

declare namespace transformMessagesTypes {
  type ToolCallIdNormalizer<TApi extends typesModule.Api> = (
    id: string,
    model: typesModule.Model<TApi>,
    source: typesModule.AssistantMessage,
  ) => string;
}

export type { transformMessagesTypes as default };
