import { Effect } from "effect";

import { splitBom } from "../../utils/text.ts";
import { ToolFailure, fromPromise } from "../platform/index.ts";
import {
  type Edit,
  applyEditsToNormalizedContent,
  detectLineEnding,
  generateDiffString,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
} from "./edit-diff.ts";

export interface EditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
}

export interface EditRequest {
  ops: EditOperations;
  path: string;
  absolutePath: string;
  edits: Edit[];
  signal: AbortSignal | undefined;
}

const accessErrorMessage = (error: unknown): string =>
  error instanceof Error && "code" in error ? `Error code: ${error.code}` : String(error);

const abortCheck = (signal: AbortSignal | undefined) =>
  Effect.suspend(() =>
    signal?.aborted === true
      ? Effect.fail(new ToolFailure({ message: "Operation aborted" }))
      : Effect.void,
  );

const accessForEdit = ({ ops, path, absolutePath, signal }: EditRequest) =>
  fromPromise(() => ops.access(absolutePath)).pipe(
    Effect.catchTag("ForeignError", (failure) =>
      abortCheck(signal).pipe(
        Effect.andThen(
          Effect.fail(
            new ToolFailure({
              cause: failure.cause,
              message: `Could not edit file: ${path}. ${accessErrorMessage(failure.cause)}.`,
            }),
          ),
        ),
      ),
    ),
  );

const editResult = (path: string, edits: Edit[], baseContent: string, newContent: string) => {
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

export const performEdit = (request: EditRequest) => {
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
