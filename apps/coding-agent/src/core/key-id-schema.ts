import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { type TSchemaOptions, Type } from "typebox";

const { Key } = tui;

const modifiers = ["ctrl", "shift", "alt", "super"] as const;
const baseKeyPattern = `(?:[a-z0-9]|${Object.values(Key)
  .flatMap((value) =>
    typeof value === "string" ? [value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&")] : [],
  )
  .join("|")})`;
const duplicateModifierPattern = modifiers
  .map((modifier) => `${modifier}\\+.*${modifier}\\+`)
  .join("|");

export const KeyIdSchema = Type.Unsafe<tuiTypes.KeyId>(
  Type.String({
    description: "Key identifier with optional ctrl, shift, alt, or super modifiers.",
    pattern: `^(?!.*(?:${duplicateModifierPattern}))(?:(?:${modifiers.join("|")})\\+){0,4}${baseKeyPattern}$`,
  }),
);

export function keybindingValueSchema(options?: TSchemaOptions) {
  return Type.Union([KeyIdSchema, Type.Array(KeyIdSchema)], options);
}

export const KeybindingValueSchema = keybindingValueSchema();
