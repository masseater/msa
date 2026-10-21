import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";
import { Type } from "typebox";

import define from "../harness/define.ts";
import type typesModule from "../harness/types.types.ts";
import editDiff from "./edit-diff.ts";
import editDisplay from "./edit-display.ts";
import type editDisplayTypes from "./edit-display.types.ts";
import type editTypes from "./edit.types.ts";
import envModule from "./env.ts";

const { defineTool } = define;
const { fileMutation, requireEnv, resolveToolPath } = envModule;
const { applyEditsToFile } = editDiff;
const { editedResult } = editDisplay;

const replaceEditSchema = Type.Object({
  newText: Type.String({ description: "Replacement text for this targeted edit." }),
  oldText: Type.String({
    description:
      "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
  }),
});

const editSchema = Type.Object({
  edits: Type.Array(replaceEditSchema, {
    description:
      "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
  }),
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
});

type LegacyEditToolInput = editTypes.EditToolInput & { oldText?: unknown; newText?: unknown };
type SingleEditInput = { oldText: string; newText: string };

function isSingleEditInput(value: unknown): value is SingleEditInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const edit = value as Record<string, unknown>;
  return typeof edit["oldText"] === "string" && typeof edit["newText"] === "string";
}

function prepareEditArguments(input: unknown): editTypes.EditToolInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return input as editTypes.EditToolInput;
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
  edits.push({ newText: legacy.newText, oldText: legacy.oldText });
  const { oldText: _oldText, newText: _newText, ...rest } = legacy;
  return { ...rest, edits };
}

function validateEditInput(input: editTypes.EditToolInput): {
  path: string;
  edits: editTypes.Edit[];
} {
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
  }
  return { edits: input.edits, path: input.path };
}

function createEditTool(): typesModule.ToolRegistration<
  typeof editSchema,
  editDisplayTypes.EditToolDetails
> {
  return defineTool({
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    execute(args, api, context) {
      return Effect.runPromise(
        Effect.gen(function* () {
          const { path, edits } = validateEditInput(args);
          const env = requireEnv(api);
          const absolutePath = yield* resolveToolPath(env, path, context);
          const target = { absolutePath, context, env, path };
          return yield* fileMutation(env, absolutePath, applyEdits(target, edits), context);
        }),
      );
    },
    name: "edit",
    parameters: editSchema,
    prepareArguments: prepareEditArguments,
  });
}

function editAccessError(path: string, error: editTypes.FileError): Error {
  return new Error(`Could not edit file: ${path}. Error code: ${error.code}.`, { cause: error });
}

const throwIfAborted = (context: chordTypes.Context): void => {
  if (context.abortSignal?.aborted === true) throw new Error("Operation aborted");
};

const readEditable = Effect.fnUntraced(function* ({
  env,
  path,
  absolutePath,
  context,
}: editTypes.EditTarget) {
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

const applyEdits = Effect.fnUntraced(function* (
  target: editTypes.EditTarget,
  edits: editTypes.Edit[],
) {
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

const editModule = {
  applyEdits,
  createEditTool,
  editSchema,
};

export default editModule;
