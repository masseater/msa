import type compatTypes from "@msa/ai/compat.types";
import type tuiTypes from "@msa/tui/index.types";

import type agentSessionServicesTypes from "../../core/agent-session-services.types.ts";
import type decideTypes from "../../core/decision/decide.types.ts";
import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import type InteractiveModeClass from "./interactive-mode.ts";

declare namespace interactiveModeTypes {
  interface InteractiveModeOptions {
    migratedProviders?: string[] | undefined;
    startupDiagnostics?: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] | undefined;
    modelFallbackMessage?: string | undefined;
    autoTrustOnReloadCwd?: string | undefined;
    decisionModelPreparation?: Promise<decideTypes.DecisionModelPreparation> | undefined;
    initialMessage?: string | undefined;
    initialImages?: compatTypes.ImageContent[] | undefined;
    initialMessages?: string[] | undefined;
    verbose?: boolean | undefined;
    tuiMode?: settingsManagerTypes.TuiMode | undefined;
    initialThemeSetting?: string | undefined;
    terminal?: tuiTypes.Terminal | undefined;
  }

  type InteractiveMode = (typeof InteractiveModeClass)["prototype"];
}

export type { interactiveModeTypes as default };
