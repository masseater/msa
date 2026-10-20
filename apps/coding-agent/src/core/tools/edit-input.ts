import { Effect } from "effect";
import { type Static, Type } from "typebox";

import { ToolFailure } from "../platform/index.ts";
import type { Edit } from "./edit-diff.ts";

const replaceEditSchema = Type.Object(
  {
    newText: Type.String({ description: "Replacement text for this targeted edit." }),
    oldText: Type.String({
      description:
        "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
    }),
  },
  {},
);

export const editSchema = Type.Object(
  {
    edits: Type.Array(replaceEditSchema, {
      description:
        "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
    }),
    path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  },
  {},
);

export const editToolSystemPromptContribution = {
  guidelines: [
    "Use edit for precise changes (edits[].oldText must match exactly)",
    "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
    "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
    "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
  ],
  snippet:
    "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
} as const;

export type EditToolInput = Static<typeof editSchema>;
type LegacyEditToolInput = EditToolInput & {
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

export function prepareEditArguments(input: unknown): EditToolInput {
  if (typeof input !== "object" || input === null) {
    return input as EditToolInput;
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
    return args as EditToolInput;
  }

  const edits = Array.isArray(legacy.edits) ? [...legacy.edits] : [];
  edits.push({ newText: legacy.newText, oldText: legacy.oldText });
  const { oldText: _oldText, newText: _newText, ...rest } = legacy;
  return { ...rest, edits } as EditToolInput;
}

export const validateEditInput = (input: EditToolInput) =>
  !Array.isArray(input.edits) || input.edits.length === 0
    ? Effect.fail(
        new ToolFailure({
          message: "Edit tool input is invalid. edits must contain at least one replacement.",
        }),
      )
    : Effect.succeed({ edits: input.edits as Edit[], path: input.path });
