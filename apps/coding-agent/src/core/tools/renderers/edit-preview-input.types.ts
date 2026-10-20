import type editDiffTypes from "../edit-diff.types.ts";

declare namespace editPreviewInputTypes {
  type RenderableEditArgs = {
    path?: string;
    file_path?: string;
    edits?: editDiffTypes.Edit[];
    oldText?: string;
    newText?: string;
  };

  interface EditPreviewRequest {
    path: string;
    edits: editDiffTypes.Edit[];
    cwd: string;
    onPreview: (preview: editDiffTypes.EditDiffResult | editDiffTypes.EditDiffError) => void;
  }
}

export type { editPreviewInputTypes as default };
