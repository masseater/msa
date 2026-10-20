import type editApplyTypes from "./edit-apply.types.ts";
import type editInputTypes from "./edit-input.types.ts";

declare namespace editTypes {
  interface EditToolDetails {
    diff: string;
    patch: string;
    firstChangedLine?: number | undefined;
  }

  interface EditToolOptions {
    operations?: editApplyTypes.EditOperations;
  }

  type EditOperations = editApplyTypes.EditOperations;

  type EditToolInput = editInputTypes.EditToolInput;
}

export type { editTypes as default };
