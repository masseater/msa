import { dual } from "effect/Function";

import type { Keybinding } from "../keybinding-definitions.ts";
import type { KeybindingsManager } from "../keybindings.ts";
import { decodePrintableKey, type KeyId, matchesKey } from "../keys.ts";

export type KeyCommand = readonly [Keybinding, () => void, KeyId?];

export const runFirstKeyCommand: {
  (commands: readonly KeyCommand[], data: string, kb: KeybindingsManager): boolean;
  (data: string, kb: KeybindingsManager): (commands: readonly KeyCommand[]) => boolean;
} = dual(3, (commands: readonly KeyCommand[], data: string, kb: KeybindingsManager): boolean => {
  const command = commands.find(
    ([binding, , key]) => kb.matches(data, binding) || (key !== undefined && matchesKey(data, key)),
  );
  command?.[1]();
  return command !== undefined;
});

export const isNewLineInput: {
  (data: string, kb: KeybindingsManager): boolean;
  (kb: KeybindingsManager): (data: string) => boolean;
} = dual(
  2,
  (data: string, kb: KeybindingsManager): boolean =>
    kb.matches(data, "tui.input.newLine") ||
    (data.charCodeAt(0) === 10 && data.length > 1) ||
    data === "\x1b\r" ||
    data === "\x1b[13;2~" ||
    (data.length > 1 && data.includes("\x1b") && data.includes("\r")) ||
    (data === "\n" && data.length === 1),
);

export const isShiftEnterSubmit: {
  (data: string, kb: KeybindingsManager): boolean;
  (kb: KeybindingsManager): (data: string) => boolean;
} = dual(2, (data: string, kb: KeybindingsManager): boolean => {
  if (!matchesKey(data, "enter")) return false;
  const submitKeys = kb.getKeys("tui.input.submit");
  return submitKeys.includes("shift+enter") || submitKeys.includes("shift+return");
});

export function printableInput(data: string): string | undefined {
  return decodePrintableKey(data) ?? (data.charCodeAt(0) >= 32 ? data : undefined);
}

export function insertableInput(data: string): string | undefined {
  return matchesKey(data, "shift+space") ? " " : printableInput(data);
}
