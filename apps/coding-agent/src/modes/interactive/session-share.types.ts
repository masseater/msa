import type tuiTypes from "@msa/tui/index.types";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import type editorSlotTypes from "./editor-slot.types.ts";

declare namespace sessionShareTypes {
  interface SessionShareContext {
    session: agentSessionTypes.AgentSession;
    ui: tuiTypes.TUI;
    editorSlot: editorSlotTypes.EditorSlot;
    showStatus: (message: string) => void;
    showError: (message: string) => void;
  }

  interface GistResult {
    stdout: string;
    stderr: string;
    code: number | null;
  }
}

export type { sessionShareTypes as default };
