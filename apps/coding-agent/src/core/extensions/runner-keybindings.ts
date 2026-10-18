import type { KeyId } from "@msa/tui";

import type { KeybindingsConfig } from "../keybindings.ts";

const RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS = [
  "app.interrupt",
  "app.clear",
  "app.exit",
  "app.suspend",
  "app.thinking.cycle",
  "app.model.cycleForward",
  "app.model.cycleBackward",
  "app.model.select",
  "app.tools.expand",
  "app.thinking.toggle",
  "app.editor.external",
  "app.message.copy",
  "app.message.followUp",
  "tui.input.submit",
  "tui.select.confirm",
  "tui.select.cancel",
  "tui.input.copy",
  "tui.editor.deleteToLineEnd",
] as const;

export type BuiltInKeyBindings = Partial<
  Record<KeyId, { keybinding: string; restrictOverride: boolean }>
>;

export const buildBuiltinKeybindings = (
  resolvedKeybindings: KeybindingsConfig,
): BuiltInKeyBindings => {
  const builtinKeybindings = {} as BuiltInKeyBindings;
  for (const [keybinding, keys] of Object.entries(resolvedKeybindings)) {
    if (keys === undefined) continue;
    const keyList = Array.isArray(keys) ? keys : [keys];
    const restrictOverride = (
      RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS as readonly string[]
    ).includes(keybinding);
    for (const key of keyList) {
      const normalizedKey = key.toLowerCase() as KeyId;
      const existing = builtinKeybindings[normalizedKey];
      if (existing?.restrictOverride === true && !restrictOverride) continue;
      builtinKeybindings[normalizedKey] = {
        keybinding,
        restrictOverride,
      };
    }
  }
  return builtinKeybindings;
};
