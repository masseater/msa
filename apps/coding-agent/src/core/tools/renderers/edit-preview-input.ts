import { Effect } from "effect";

import editDiff from "../edit-diff.ts";
import type editDiffTypes from "../edit-diff.types.ts";
import type editPreviewInputTypes from "./edit-preview-input.types.ts";

const { computeEditsDiff } = editDiff;

function getRenderablePreviewInput(
  args: editPreviewInputTypes.RenderableEditArgs | undefined,
): { path: string; edits: editDiffTypes.Edit[] } | null {
  if (args === undefined) {
    return null;
  }

  const path =
    typeof args.path === "string"
      ? args.path
      : typeof args.file_path === "string"
        ? args.file_path
        : null;
  if (path === null || path === "") {
    return null;
  }

  if (
    Array.isArray(args.edits) &&
    args.edits.length > 0 &&
    args.edits.every(
      (edit) => typeof edit?.oldText === "string" && typeof edit?.newText === "string",
    )
  ) {
    return { edits: args.edits, path };
  }

  if (typeof args.oldText === "string" && typeof args.newText === "string") {
    return { edits: [{ newText: args.newText, oldText: args.oldText }], path };
  }

  return null;
}

function requestEditPreview({
  path,
  edits,
  cwd,
  onPreview,
}: editPreviewInputTypes.EditPreviewRequest): void {
  Effect.runFork(
    Effect.promise(() => computeEditsDiff(path, edits, cwd)).pipe(
      Effect.andThen((preview) => Effect.sync(() => onPreview(preview))),
    ),
  );
}

const editPreviewInput = {
  getRenderablePreviewInput,
  requestEditPreview,
};

export default editPreviewInput;
