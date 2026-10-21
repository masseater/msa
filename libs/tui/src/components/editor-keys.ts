import { dual } from "effect/Function";

import type keybindingsTypes from "../keybindings.types.ts";
import keys from "../keys.ts";
import type editorKeysTypes from "./editor-keys.types.ts";

const { decodePrintableKey, matchesKey } = keys;

const runFirstKeyCommand: {
  (
    commands: readonly editorKeysTypes.KeyCommand[],
    data: string,
    kb: keybindingsTypes.KeybindingsManager,
  ): boolean;
  (
    data: string,
    kb: keybindingsTypes.KeybindingsManager,
  ): (commands: readonly editorKeysTypes.KeyCommand[]) => boolean;
} = dual(
  3,
  (
    commands: readonly editorKeysTypes.KeyCommand[],
    data: string,
    kb: keybindingsTypes.KeybindingsManager,
  ): boolean => {
    const command = commands.find(
      ([binding, , key]) =>
        kb.matches(data, binding) || (key !== undefined && matchesKey(data, key)),
    );
    command?.[1]();
    return command !== undefined;
  },
);

const isNewLineInput: {
  (data: string, kb: keybindingsTypes.KeybindingsManager): boolean;
  (kb: keybindingsTypes.KeybindingsManager): (data: string) => boolean;
} = dual(
  2,
  (data: string, kb: keybindingsTypes.KeybindingsManager): boolean =>
    kb.matches(data, "tui.input.newLine") ||
    (data.charCodeAt(0) === 10 && data.length > 1) ||
    data === "\x1b\r" ||
    data === "\x1b[13;2~" ||
    (data.length > 1 && data.includes("\x1b") && data.includes("\r")) ||
    (data === "\n" && data.length === 1),
);

const isShiftEnterSubmit: {
  (data: string, kb: keybindingsTypes.KeybindingsManager): boolean;
  (kb: keybindingsTypes.KeybindingsManager): (data: string) => boolean;
} = dual(2, (data: string, kb: keybindingsTypes.KeybindingsManager): boolean => {
  if (!matchesKey(data, "enter")) return false;
  const submitKeys = kb.getKeys("tui.input.submit");
  return submitKeys.includes("shift+enter") || submitKeys.includes("shift+return");
});

function printableInput(data: string): string | undefined {
  return decodePrintableKey(data) ?? (data.charCodeAt(0) >= 32 ? data : undefined);
}

function insertableInput(data: string): string | undefined {
  return matchesKey(data, "shift+space") ? " " : printableInput(data);
}

const editorKeys = {
  insertableInput,
  isNewLineInput,
  isShiftEnterSubmit,
  printableInput,
  runFirstKeyCommand,
};

export default editorKeys;
