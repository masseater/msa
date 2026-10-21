import { Effect, FileSystem } from "effect";

import platform from "../platform/index.ts";
import nodeRuntime from "../platform/runtime.ts";
import editApply from "./edit-apply.ts";
import editInput from "./edit-input.ts";
import type editTypes from "./edit.types.ts";
import fileMutationQueue from "./file-mutation-queue.ts";
import pathUtils from "./path-utils.ts";

const { performEdit } = editApply;
const { validateEditInput } = editInput;
const { fromPromise, rethrowCause, unwrapForeign } = platform;
const { resolveToCwd } = pathUtils;
const { withFileMutationQueue } = fileMutationQueue;

const defaultEditOperations: editTypes.EditOperations = {
  access: (path) =>
    nodeRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.access(path, { readable: true, writable: true })),
      ),
    ),
  readFile: (path) =>
    nodeRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.readFile(path)).pipe(
          Effect.map((bytes) => Buffer.from(bytes)),
        ),
      ),
    ),
  writeFile: (path, content) =>
    nodeRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.writeFileString(path, content))),
    ),
};

interface EditFileRequest {
  cwd: string;
  input: editTypes.EditToolInput;
  ops: editTypes.EditOperations;
  signal: AbortSignal | undefined;
}

const editFile = ({ cwd, input, ops, signal }: EditFileRequest) =>
  nodeRuntime.runPromise(
    unwrapForeign(
      Effect.gen(function* () {
        const { path, edits } = yield* validateEditInput(input);
        const absolutePath = resolveToCwd(path, cwd);
        return yield* fromPromise(() =>
          withFileMutationQueue(absolutePath, () =>
            nodeRuntime.runPromise(
              unwrapForeign(performEdit({ absolutePath, edits, ops, path, signal })),
            ),
          ),
        );
      }),
    ),
  );

const editFileModule = { defaultEditOperations, editFile };

export default editFileModule;
