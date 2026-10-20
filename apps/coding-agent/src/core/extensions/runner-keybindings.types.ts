import type tuiTypes from "@msa/tui/index.types";

declare namespace runnerKeybindingsTypes {
  type BuiltInKeyBindings = Partial<
    Record<tuiTypes.KeyId, { keybinding: string; restrictOverride: boolean }>
  >;
}

export type { runnerKeybindingsTypes as default };
