import type callRowsTypes from "./call-rows.types.ts";
import type codemodeSourceTypes from "./codemode.types.ts";
import type describeTypes from "./describe.types.ts";
import type runDocsTypes from "./run-docs.types.ts";

declare namespace codemodeTypes {
  type CodemodeGlobal = runDocsTypes.CodemodeGlobal;

  type CodemodeNestedCall = callRowsTypes.CodemodeNestedCall;

  type CodemodeToolDetails = callRowsTypes.CodemodeToolDetails;

  type CodemodeToolInput = codemodeSourceTypes.CodemodeToolInput;

  type CodemodeToolOptions = runDocsTypes.CodemodeToolOptions;

  type CodemodeNamespace = describeTypes.CodemodeNamespace;
}

export type { codemodeTypes as default };
