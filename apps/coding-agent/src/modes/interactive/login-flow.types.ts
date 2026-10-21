import type tuiTypes from "@msa/tui/index.types";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import type oauthSelectorTypes from "./components/oauth-selector.types.ts";
import type editorSlotTypes from "./editor-slot.types.ts";
import type LoginFlowClass from "./login-flow.ts";
import type programStatusReporterTypes from "./program-status-reporter.types.ts";

declare namespace loginFlowTypes {
  type AuthType = oauthSelectorTypes.AuthSelectorProvider["authType"];

  type LoginProviderCompletionOption = {
    id: string;
    name: string;
    authTypes: AuthType[];
    subscription?: boolean | undefined;
  };

  interface LoginFlowHost {
    readonly ui: tuiTypes.TUI;
    readonly session: agentSessionTypes.AgentSession;
    readonly programStatus: programStatusReporterTypes.ProgramStatusReporter;
    readonly editorSlot: editorSlotTypes.EditorSlot;
    showStatus(message: string): void;
    showWarning(message: string): void;
    showError(message: string): void;
    refreshAuthState(): void;
  }

  type LoginFlow = (typeof LoginFlowClass)["prototype"];
}

export type { loginFlowTypes as default };
