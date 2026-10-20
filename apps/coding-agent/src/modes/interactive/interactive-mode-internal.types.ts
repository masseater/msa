import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import type tuiTypes from "@msa/tui/index.types";
import type { Effect } from "effect";

import type sessionManagerTypes from "../../core/session-manager.types.ts";
import type statusIndicatorTypes from "./components/status-indicator.types.ts";

declare namespace interactiveModeInternalTypes {
  interface ActiveEditor extends tuiTypes.EditorComponent {
    getCursor?(): { line: number; col: number };
  }

  interface WorkingStatusEditor extends tuiTypes.EditorComponent {
    readonly embedWorkingStatus: boolean;
    setWorkingStatusIndicator(indicator: statusIndicatorTypes.StatusIndicator | undefined): void;
  }

  type CompactionQueuedMessage = {
    text: string;
    mode: "steer" | "followUp";
  };

  type CompactionCostNotice = {
    type: "compaction_cost";
    kind: "compaction" | "branch_summary";
    usage: compatTypes.Usage;
  };

  type RenderSessionItem =
    | agentTypes.AgentMessage
    | Extract<sessionManagerTypes.SessionEntry, { type: "custom" | "usage" }>
    | CompactionCostNotice;

  type CustomComponent = tuiTypes.Component & { dispose?(): void };

  interface ExtensionCustomOptions {
    overlay?: boolean;
    overlayOptions?: tuiTypes.OverlayOptions | (() => tuiTypes.OverlayOptions);
    onHandle?: (handle: tuiTypes.OverlayHandle) => void;
  }

  interface ScopedModelsState {
    currentEnabledIds: string[] | null;
    availableModelIds: Set<string>;
    availableModels: compatTypes.Model<any>[];
    selectionChanged: boolean;
    sessionScopedModels: readonly {
      model: compatTypes.Model<any>;
      thinkingLevel?: agentTypes.ThinkingLevel | undefined;
    }[];
    configuredEnabledIds: (models: readonly compatTypes.Model<any>[]) => string[] | null;
    disposed: boolean;
    timedOut: boolean;
  }

  interface BuiltinCommand {
    readonly args: boolean;
    readonly clearFirst: boolean;
    readonly run: (text: string) => Effect.Effect<unknown>;
  }
}

export type { interactiveModeInternalTypes as default };
