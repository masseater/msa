import type codingAgentTypes from "@msa/coding-agent/index.types";
import type tuiTypes from "@msa/tui/index.types";

declare namespace showOverlayTypes {
  type OverlayFactory<T> = (
    tui: tuiTypes.TUI,
    theme: codingAgentTypes.Theme,
    keybindings: codingAgentTypes.KeybindingsManager,
    done: (result: T) => void,
  ) => tuiTypes.Component;
}

export type { showOverlayTypes as default };
