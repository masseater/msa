import { Effect } from "effect";

import platform from "../platform/index.ts";
import type editDiffTypes from "./edit-diff.types.ts";
import type editInputTypes from "./edit-input.types.ts";
import editSchemaModule from "./edit-schema.ts";

const { ToolFailure } = platform;
const { editSchema } = editSchemaModule;

const editToolSystemPromptContribution = {
  guidelines: [
    "Use edit for precise changes (edits[].oldText must match exactly)",
    "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
    "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
    "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
  ],
  snippet:
    "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
} as const;

type LegacyEditToolInput = editInputTypes.EditToolInput & {
  oldText?: unknown;
  newText?: unknown;
};

type SingleEditInput = { oldText: string; newText: string };

function isSingleEditInput(value: unknown): value is SingleEditInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const edit = value as Record<string, unknown>;
  return typeof edit["oldText"] === "string" && typeof edit["newText"] === "string";
}

function prepareEditArguments(input: unknown): editInputTypes.EditToolInput {
  if (typeof input !== "object" || input === null) {
    return input as editInputTypes.EditToolInput;
  }

  const args = input as Record<string, unknown>;

  if (typeof args["edits"] === "string") {
    try {
      const parsed = JSON.parse(args["edits"]);
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
  if (typeof legacy.oldText !== "string" || typeof legacy.newText !== "string") {
    return args as editInputTypes.EditToolInput;
  }

  const edits = Array.isArray(legacy.edits) ? [...legacy.edits] : [];
  edits.push({ newText: legacy.newText, oldText: legacy.oldText });
  const { oldText: _oldText, newText: _newText, ...rest } = legacy;
  return { ...rest, edits } as editInputTypes.EditToolInput;
}

const validateEditInput = (input: editInputTypes.EditToolInput) =>
  !Array.isArray(input.edits) || input.edits.length === 0
    ? Effect.fail(
        new ToolFailure({
          message: "Edit tool input is invalid. edits must contain at least one replacement.",
        }),
      )
    : Effect.succeed({ edits: input.edits as editDiffTypes.Edit[], path: input.path });

const editInput = {
  editSchema,
  editToolSystemPromptContribution,
  prepareEditArguments,
  validateEditInput,
};

export default editInput;
