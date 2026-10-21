import type durableTypes from "@msa/durable/index.types";

import type codemodeTypes from "../src/codemode/codemode.types.ts";

declare namespace codemodeDurableCodeModeTestTypes {
  type CodemodeToolDetails = codemodeTypes.CodemodeToolDetails;

  type ToolTaskInput = durableTypes.ToolTaskInput;
}

export type { codemodeDurableCodeModeTestTypes as default };
