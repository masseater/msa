import type typesModule from "../types.types.ts";
import type googleThinkingTypes from "./google-thinking.types.ts";

declare namespace googleSimpleOptionsTypes {
  interface GoogleSimpleRequest<T extends googleThinkingTypes.GoogleApiType> {
    readonly model: typesModule.Model<T>;
    readonly context: typesModule.TranscriptContext;
    readonly options: typesModule.SimpleStreamOptions | undefined;
    readonly apiKey: string | undefined;
    readonly budgetFor: (
      level: googleThinkingTypes.ResolvedGoogleThinkingLevel,
      customBudgets: typesModule.ThinkingBudgets | undefined,
    ) => number;
  }
}

export type { googleSimpleOptionsTypes as default };
