import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Function, ManagedRuntime, Predicate, Result } from "effect";

import errors from "../../utils/errors.ts";
import textModule from "../../utils/text.ts";
import diffFormat from "./diff-format.ts";
import type diffFormatTypes from "./diff-format.types.ts";
import type editDiffTypes from "./edit-diff.types.ts";
import editMatch from "./edit-match.ts";
import editText from "./edit-text.ts";
import pathUtils from "./path-utils.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { generateDiffString } = diffFormat;
const { detectLineEnding, normalizeToLF, restoreLineEndings } = editText;
const { applyEditsImpl, applyEditsToNormalizedContent, fuzzyFindText } = editMatch;
const { toErrorMessage } = errors;
const { splitBom } = textModule;
const { resolveToCwd } = pathUtils;

const causeOf = (error: unknown): unknown =>
  Predicate.hasProperty(error, "cause") && error.cause !== undefined ? error.cause : error;

const failureMessage = (error: unknown): string => toErrorMessage(causeOf(error));

const describeAccessError = (error: unknown): string => {
  const cause = causeOf(error);
  return cause instanceof Error && "code" in cause ? `Error code: ${cause.code}` : String(cause);
};

const diffFromContent = (
  rawContent: string,
  edits: editDiffTypes.Edit[],
  path: string,
): diffFormatTypes.EditDiffResult => {
  const { text: content } = splitBom(rawContent);
  const { baseContent, newContent } = applyEditsImpl(normalizeToLF(content), edits, path);
  return generateDiffString(baseContent, newContent);
};

const computeDiffEffect = (path: string, edits: editDiffTypes.Edit[], cwd: string) => {
  const absolutePath = resolveToCwd(path, cwd);
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const access = yield* Effect.result(fs.access(absolutePath, { readable: true }));
    if (Result.isFailure(access)) {
      const error = `Could not edit file: ${path}. ${describeAccessError(access.failure)}.`;
      return { error };
    }
    const rawContent = yield* fs.readFileString(absolutePath, "utf-8");
    return yield* Effect.try(() => diffFromContent(rawContent, edits, path));
  }).pipe(Effect.catch((error) => Effect.succeed({ error: failureMessage(error) })));
};

const computeEditsDiff: {
  (
    edits: editDiffTypes.Edit[],
    cwd: string,
  ): (path: string) => Promise<diffFormatTypes.EditDiffResult | editDiffTypes.EditDiffError>;
  (
    path: string,
    edits: editDiffTypes.Edit[],
    cwd: string,
  ): Promise<diffFormatTypes.EditDiffResult | editDiffTypes.EditDiffError>;
} = Function.dual(
  (args) => typeof args[0] === "string",
  (
    path: string,
    edits: editDiffTypes.Edit[],
    cwd: string,
  ): Promise<diffFormatTypes.EditDiffResult | editDiffTypes.EditDiffError> =>
    nodeRuntime.runPromise(computeDiffEffect(path, edits, cwd)),
);

const editDiff = {
  applyEditsToNormalizedContent,
  computeEditsDiff,
  detectLineEnding,
  fuzzyFindText,
  generateDiffString: diffFormat.generateDiffString,
  generateUnifiedPatch: diffFormat.generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
};

export default editDiff;
