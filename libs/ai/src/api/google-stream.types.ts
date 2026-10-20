import type { GoogleGenAI } from "@google/genai";

import type typesModule from "../types.types.ts";
import type googleParamsTypes from "./google-params.types.ts";
import type googleThinkingTypes from "./google-thinking.types.ts";

declare namespace googleStreamTypes {
  interface GoogleStreamSpec<
    T extends googleThinkingTypes.GoogleApiType,
    O extends googleParamsTypes.GoogleRequestOptions,
  > {
    readonly model: typesModule.Model<T>;
    readonly context: typesModule.TranscriptContext;
    readonly options: O | undefined;
    readonly adapterName: string;
    readonly streamName: string;
    readonly createClient: (options: O | undefined) => GoogleGenAI;
  }
}

export type { googleStreamTypes as default };
