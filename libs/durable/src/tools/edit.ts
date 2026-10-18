import type { Context } from "@msa/chord";
import { Effect } from "effect";
import { type Static, Type } from "typebox";

import type { FileError } from "../env/index.ts";
import { defineTool } from "../harness/define.ts";
import type { ToolRegistration } from "../harness/types.ts";
import { applyEditsToFile, type Edit } from "./edit-diff.ts";
import { editedResult, type EditToolDetails } from "./edit-display.ts";
import { fileMutation, requireEnv, resolveToolPath } from "./env.ts";

export type { EditToolDetails } from "./edit-display.ts";

const replaceEditSchema = Type.Object({
  oldText: Type.String({
    description:
      "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
  }),
  newText: Type.String({ description: "Replacement text for this targeted edit." }),
});

const editSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  edits: Type.Array(replaceEditSchema, {
    description:
      "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
  }),
});

export type EditToolInput = Static<typeof editSchema>;
type LegacyEditToolInput = EditToolInput & { oldText?: unknown; newText?: unknown };
type SingleEditInput = { oldText: string; newText: string };

function isSingleEditInput(value: unknown): value is SingleEditInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const edit = value as Record<string, unknown>;
  return typeof edit["oldText"] === "string" && typeof edit["newText"] === "string";
}

function prepareEditArguments(input: unknown): EditToolInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return input as EditToolInput;
  }
  const args: Record<string, unknown> = { ...input };
  if (typeof args["edits"] === "string") {
    try {
      const parsed: unknown = JSON.parse(args["edits"]);
      if (Array.isArray(parsed)) {
        args["edits"] = parsed;
      } else if (isSingleEditInput(parsed)) {
        args["edits"] = [parsed];
      }
    } catch {}
  } else if (isSingleEditInput(args["edits"])) {
    args["edits"] = [args["edits"]];
  }

  const legacy = args as LegacyEditToolInput;
  if (typeof legacy.oldText !== "string" || typeof legacy.newText !== "string") return legacy;
  const edits = Array.isArray(legacy.edits) ? [...legacy.edits] : [];
  edits.push({ oldText: legacy.oldText, newText: legacy.newText });
  const { oldText: _oldText, newText: _newText, ...rest } = legacy;
  return { ...rest, edits };
}

function validateEditInput(input: EditToolInput): { path: string; edits: Edit[] } {
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
  }
  return { path: input.path, edits: input.edits };
}

export function createEditTool(): ToolRegistration<typeof editSchema, EditToolDetails> {
  return defineTool({
    name: "edit",
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    parameters: editSchema,
    prepareArguments: prepareEditArguments,
    execute(args, api, context) {
      return Effect.runPromise(
        Effect.gen(function* () {
          const { path, edits } = validateEditInput(args);
          const env = requireEnv(api);
          const absolutePath = yield* resolveToolPath(env, path, context);
          const target = { env, path, absolutePath, context };
          return yield* fileMutation(env, absolutePath, applyEdits(target, edits), context);
        }),
      );
    },
  });
}

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
