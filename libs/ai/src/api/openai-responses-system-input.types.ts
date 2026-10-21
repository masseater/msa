import type typesModule from "../types.types.ts";
import type openaiResponsesOptionsTypes from "./openai-responses-options.ts";

declare namespace openaiResponsesSystemInputTypes {
  interface ConversionScope<TApi extends typesModule.Api> {
    readonly model: typesModule.Model<TApi>;
    readonly options: openaiResponsesOptionsTypes.ConvertResponsesMessagesOptions | undefined;
    readonly instructionRole: "developer" | "system";
    readonly anchorsAdditions: boolean;
  }

  interface Position {
    readonly leading: boolean;
    readonly msgIndex: number;
  }

  interface SystemConversion<TApi extends typesModule.Api> {
    readonly scope: ConversionScope<TApi>;
    readonly message: typesModule.SystemMessage;
    readonly position: Position;
  }
}

export type { openaiResponsesSystemInputTypes as default };
