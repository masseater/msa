import type { Context } from "@msa/chord";
import { Effect } from "effect";

import type { FileError } from "../env/index.ts";
import { applyEditsToFile, type Edit } from "./edit-diff.ts";
import { editedResult } from "./edit-display.ts";
import type { requireEnv } from "./env.ts";

function editAccessError(path: string, error: FileError): Error {
  return new Error(`Could not edit file: ${path}. Error code: ${error.code}.`, { cause: error });
}

export type EditTarget = {
  readonly env: ReturnType<typeof requireEnv>;
  readonly path: string;
  readonly absolutePath: string;
  readonly context: Context;
};

const throwIfAborted = (context: Context): void => {
  if (context.abortSignal?.aborted === true) throw new Error("Operation aborted");
};

const readEditable = Effect.fnUntraced(function* ({
  env,
  path,
  absolutePath,
  context,
}: EditTarget) {
  throwIfAborted(context);
  const info = yield* Effect.promise(() => env.fileInfo(absolutePath, context));
  if (!info.ok) throw editAccessError(path, info.error);
  if (info.value.kind !== "file" && info.value.kind !== "symlink") {
    throw new Error(`Could not edit file: ${path}. Path is not a file.`);
  }
  const read = yield* Effect.promise(() => env.readTextFile(absolutePath, context));
  if (!read.ok) throw editAccessError(path, read.error);
  throwIfAborted(context);
  return read.value;
});

export const applyEdits = Effect.fnUntraced(function* (target: EditTarget, edits: Edit[]) {
  const { env, path, absolutePath, context } = target;
  const { baseContent, newContent, fileContent } = applyEditsToFile(
    yield* readEditable(target),
    edits,
    path,
  );
  throwIfAborted(context);
  const written = yield* Effect.promise(() => env.writeFile(absolutePath, fileContent, context));
  if (!written.ok) throw editAccessError(path, written.error);
  throwIfAborted(context);
  return editedResult(path, edits.length, baseContent, newContent);
});
