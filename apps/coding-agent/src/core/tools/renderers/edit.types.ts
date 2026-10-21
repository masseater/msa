import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../extensions/types.types.ts";
import type editDiffTypes from "../edit-diff.types.ts";
import type editToolTypes from "../edit.types.ts";

declare namespace editTypes {
  type EditPreview = editDiffTypes.EditDiffResult | editDiffTypes.EditDiffError;

  type EditRenderState = {
    callComponent?: EditCallRenderComponent;
  };

  type EditCallRenderComponent = tuiTypes.Box & {
    preview?: EditPreview | undefined;
    previewArgsKey?: string | undefined;
    previewPending?: boolean;
    settledError?: boolean;
  };

  interface EditToolResultLike {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    details?: editToolTypes.EditToolDetails;
  }

  type EditRenderResultContext = Parameters<
    NonNullable<extensionsTypesTypes.ToolDefinition<any, any>["renderResult"]>
  >[3];
}

export type { editTypes as default };
