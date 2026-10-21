import type typesModuleModule from "../types.types.ts";
import type callRowsTypes from "./call-rows.types.ts";

declare namespace runPersistTypes {
  type CodemodeToolDetails = callRowsTypes.CodemodeToolDetails;

  type JsonObject = typesModuleModule.JsonObject;
}

export type { runPersistTypes as default };
