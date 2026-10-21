import type tuiTypes from "@msa/tui/index.types";

import type agentSessionRuntimeTypes from "../../core/agent-session-runtime.types.ts";
import type keybindingsTypes from "../../core/keybindings.types.ts";
import type customEditorTypes from "./components/custom-editor.types.ts";
import type footerTypes from "./components/footer.types.ts";
import type editorSlotTypes from "./editor-slot.types.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import type interactiveModeTypes from "./interactive-mode.types.ts";

declare namespace interactiveModeHandlesTypes {
  type RuntimeHost = agentSessionRuntimeTypes.AgentSessionRuntime;
  type Options = interactiveModeTypes.InteractiveModeOptions;
  type Tui = tuiTypes.TUI;
  type DefaultEditor = customEditorTypes.CustomEditor;
  type ActiveEditor = interactiveModeInternalTypes.ActiveEditor;
  type EditorSlot = editorSlotTypes.EditorSlot;
  type Keybindings = keybindingsTypes.KeybindingsManager;
  type Footer = footerTypes.FooterComponent;
}

export type { interactiveModeHandlesTypes as default };
