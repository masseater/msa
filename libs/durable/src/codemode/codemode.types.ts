import type { Static } from "typebox";

import type callRowsTypes from "./call-rows.types.ts";
import type codemode from "./codemode.ts";
import type runDocsTypes from "./run-docs.types.ts";

declare namespace codemodeTypes {
  type CodemodeToolInput = Static<typeof codemode.codemodeSchema>;

  type CodemodeNestedCall = callRowsTypes.CodemodeNestedCall;

  type CodemodeToolDetails = callRowsTypes.CodemodeToolDetails;

  type CodemodeGlobal = runDocsTypes.CodemodeGlobal;

  type CodemodeToolOptions = runDocsTypes.CodemodeToolOptions;
}

export type { codemodeTypes as default };
