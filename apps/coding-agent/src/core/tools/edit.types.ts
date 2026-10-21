import type extensionsTypesTypes from "../extensions/types.types.ts";
import type editApplyTypes from "./edit-apply.types.ts";
import type editInputModule from "./edit-input.ts";
import type editInputTypes from "./edit-input.types.ts";
import type editRendererTypes from "./renderers/edit.types.ts";

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

  type EditToolContext = extensionsTypesTypes.ExtensionContext;

  type EditToolDefinition = extensionsTypesTypes.ToolDefinition<
    typeof editInputModule.editSchema,
    EditToolDetails | undefined,
    editRendererTypes.EditRenderState
  >;
}

export type { editTypes as default };
