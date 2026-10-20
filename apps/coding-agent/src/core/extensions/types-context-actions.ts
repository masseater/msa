import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type modelResolverTypes from "../model-resolver.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import type systemPromptTypes from "../system-prompt.types.ts";
import type typesActionsTypes from "./types-actions.ts";
import type typesContextTypes from "./types-context.ts";
import type typesUiTypes from "./types-ui.ts";

declare namespace typesContextActionsTypes {
  interface ExtensionContextActions {
    getModel: () => aiTypes.Model<any> | undefined;
    getScopedModels: () => readonly modelResolverTypes.ScopedModel[];
    isIdle: () => boolean;
    isProjectTrusted: () => boolean;
    getSignal: () => AbortSignal | undefined;
    abort: () => void;
    hasPendingMessages: () => boolean;
    shutdown: () => void;
    getContextUsage: () => typesUiTypes.ContextUsage | undefined;
    compact: (options?: typesUiTypes.CompactOptions) => void;
    getSystemPrompt: () => string;
    getSystemPromptOptions?: () => systemPromptTypes.BuildSystemPromptOptions;
    executeTool?: (
      callerId: string,
      name: string,
      args: unknown,
      options: typesContextTypes.ExecuteToolOptions,
    ) => Promise<agentTypes.AgentToolCallOutcome>;
    getCallableTools?: () => readonly agentTypes.AgentTool[];
  }

  interface ExtensionCommandContextActions {
    waitForIdle: () => Promise<void>;
    newSession: (options?: {
      parentSession?: string;
      setup?: (sessionManager: sessionManagerTypes.SessionManager) => Promise<void>;
      withSession?: (ctx: typesContextTypes.ReplacedSessionContext) => Promise<void>;
    }) => Promise<{ cancelled: boolean }>;
    fork: (
      entryId: string,
      options?: {
        position?: "before" | "at";
        withSession?: (ctx: typesContextTypes.ReplacedSessionContext) => Promise<void>;
      },
    ) => Promise<{ cancelled: boolean }>;
    navigateTree: (
      targetId: string,
      options?: {
        summarize?: boolean;
        customInstructions?: string;
        replaceInstructions?: boolean;
        label?: string;
      },
    ) => Promise<{ cancelled: boolean }>;
    switchSession: (
      sessionPath: string,
      options?: { withSession?: (ctx: typesContextTypes.ReplacedSessionContext) => Promise<void> },
    ) => Promise<{ cancelled: boolean }>;
    reload: () => Promise<void>;
  }

  interface ExtensionRuntime
    extends typesActionsTypes.ExtensionRuntimeState, typesActionsTypes.ExtensionActions {}
}

export type { typesContextActionsTypes as default };
