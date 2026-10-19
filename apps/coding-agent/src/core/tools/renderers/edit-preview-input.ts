import { Effect } from "effect";

import { platformRuntime } from "../../platform/index.ts";
import {
  computeEditsDiff,
  type Edit,
  type EditDiffError,
  type EditDiffResult,
} from "../edit-diff.ts";

export type RenderableEditArgs = {
  path?: string;
  file_path?: string;
  edits?: Edit[];
  oldText?: string;
  newText?: string;
};

export function getRenderablePreviewInput(
  args: RenderableEditArgs | undefined,
): { path: string; edits: Edit[] } | null {
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
    return { path, edits: args.edits };
  }

  if (typeof args.oldText === "string" && typeof args.newText === "string") {
    return { path, edits: [{ oldText: args.oldText, newText: args.newText }] };
  }

  return null;
}

export interface EditPreviewRequest {
  path: string;
  edits: Edit[];
  cwd: string;
  onPreview: (preview: EditDiffResult | EditDiffError) => void;
}

export function requestEditPreview({ path, edits, cwd, onPreview }: EditPreviewRequest): void {
  platformRuntime.runFork(
    Effect.promise(() => computeEditsDiff(path, edits, cwd)).pipe(
      Effect.andThen((preview) => Effect.sync(() => onPreview(preview))),
    ),
  );
}
