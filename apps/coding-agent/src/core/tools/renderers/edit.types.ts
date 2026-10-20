import type tuiTypes from "@msa/tui/index.types";

import type editDiffTypes from "../edit-diff.types.ts";

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
}

export type { editTypes as default };
