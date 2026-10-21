import type tuiTypes from "@msa/tui/index.types";

import type keybindingsTypes from "../keybindings.types.ts";
import type runnerKeybindingsTypes from "./runner-keybindings.types.ts";

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

const buildBuiltinKeybindings = (
  resolvedKeybindings: keybindingsTypes.KeybindingsConfig,
): runnerKeybindingsTypes.BuiltInKeyBindings => {
  const builtinKeybindings = {} as runnerKeybindingsTypes.BuiltInKeyBindings;
  for (const [keybinding, keys] of Object.entries(resolvedKeybindings)) {
    if (keys === undefined) continue;
    const keyList = Array.isArray(keys) ? keys : [keys];
    const restrictOverride = (
      RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS as readonly string[]
    ).includes(keybinding);
    for (const key of keyList) {
      const normalizedKey = key.toLowerCase() as tuiTypes.KeyId;
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

const runnerKeybindings = {
  buildBuiltinKeybindings,
};

export default runnerKeybindings;
