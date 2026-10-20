import type typesModule from "../types.types.ts";

declare namespace openaiResponsesUserInputTypes {
  interface ToolResultConversion<TApi extends typesModule.Api> {
    readonly model: typesModule.Model<TApi>;
    readonly message: typesModule.ToolResultMessage;
    readonly grammarToolInputProperties: ReadonlyMap<string, string> | undefined;
  }
}

export type { openaiResponsesUserInputTypes as default };
