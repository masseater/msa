import type tuiTypes from "@msa/tui/index.types";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import type keybindingsTypes from "../../core/keybindings.types.ts";
import type editorSlotTypes from "./editor-slot.types.ts";

declare namespace bugReportInternalTypes {
  interface BugReportContext {
    session: agentSessionTypes.AgentSession;
    ui: tuiTypes.TUI;
    editorSlot: editorSlotTypes.EditorSlot;
    keybindings: keybindingsTypes.KeybindingsManager;
    showStatus: (message: string) => void;
    showError: (message: string) => void;
  }

  interface BugReportOptions {
    hint?: string | undefined;
    includeSession: boolean;
    includeSummary: boolean;
  }

  type Overlay = tuiTypes.Container & { dispose?: () => void };
}

export type { bugReportInternalTypes as default };
