import { Effect } from "effect";

import textModule from "../../utils/text.ts";
import platform from "../platform/index.ts";
import type editApplyTypes from "./edit-apply.types.ts";
import editDiff from "./edit-diff.ts";
import type editDiffTypes from "./edit-diff.types.ts";

const { ToolFailure, fromPromise } = platform;
const {
  applyEditsToNormalizedContent,
  detectLineEnding,
  generateDiffString,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
} = editDiff;
const { splitBom } = textModule;

const accessErrorMessage = (error: unknown): string =>
  error instanceof Error && "code" in error ? `Error code: ${error.code}` : String(error);

const abortCheck = (signal: AbortSignal | undefined) =>
  Effect.suspend(() =>
    signal?.aborted === true
      ? Effect.fail(ToolFailure.make({ message: "Operation aborted" }))
      : Effect.void,
  );

const accessForEdit = ({ ops, path, absolutePath, signal }: editApplyTypes.EditRequest) =>
  fromPromise(() => ops.access(absolutePath)).pipe(
    Effect.catchTag("ForeignError", (failure) =>
      abortCheck(signal).pipe(
        Effect.andThen(
          Effect.fail(
            ToolFailure.make({
              cause: failure.cause,
              message: `Could not edit file: ${path}. ${accessErrorMessage(failure.cause)}.`,
            }),
          ),
        ),
      ),
    ),
  );

const editResult = (
  path: string,
  edits: editDiffTypes.Edit[],
  baseContent: string,
  newContent: string,
) => {
  const diffResult = generateDiffString(baseContent, newContent);
  return {
    content: [
      {
        text: `Successfully replaced ${edits.length} block(s) in ${path}.`,
        type: "text" as const,
      },
    ],
    details: {
      diff: diffResult.diff,
      firstChangedLine: diffResult.firstChangedLine,
      patch: generateUnifiedPatch(path, baseContent, newContent),
    },
  };
};

const performEdit = (request: editApplyTypes.EditRequest) => {
  const { ops, path, absolutePath, edits, signal } = request;
  const throwIfAborted = abortCheck(signal);
  return Effect.gen(function* () {
    yield* throwIfAborted;
    yield* accessForEdit(request);
    yield* throwIfAborted;
    const buffer = yield* fromPromise(() => ops.readFile(absolutePath));
    yield* throwIfAborted;
    const { bom, text: content } = splitBom(buffer.toString("utf-8"));
    const originalEnding = detectLineEnding(content);
    const { baseContent, newContent } = yield* Effect.sync(() =>
      applyEditsToNormalizedContent(normalizeToLF(content), edits, path),
    );
    yield* throwIfAborted;
    yield* fromPromise(() =>
      ops.writeFile(absolutePath, bom + restoreLineEndings(newContent, originalEnding)),
    );
    yield* throwIfAborted;
    return editResult(path, edits, baseContent, newContent);
  });
};

const editApply = {
  performEdit,
};

export default editApply;
