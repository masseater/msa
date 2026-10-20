import type googleParamsTypes from "./google-params.types.ts";

declare namespace googleGenerativeAiTypes {
  interface GoogleOptions extends googleParamsTypes.GoogleRequestOptions {}
}

export type { googleGenerativeAiTypes as default };
