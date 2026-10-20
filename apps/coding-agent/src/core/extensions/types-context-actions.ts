import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type { ScopedModel } from "../model-resolver.ts";
import type { SessionManager } from "../session-manager.ts";
import type { BuildSystemPromptOptions } from "../system-prompt.ts";
import type { ExtensionActions, ExtensionRuntimeState } from "./types-actions.ts";
import type { ExecuteToolOptions, ReplacedSessionContext } from "./types-context.ts";
import type { CompactOptions, ContextUsage } from "./types-ui.ts";

export interface ExtensionContextActions {
  getModel: () => aiTypes.Model<any> | undefined;
  getScopedModels: () => readonly ScopedModel[];
  isIdle: () => boolean;
  isProjectTrusted: () => boolean;
  getSignal: () => AbortSignal | undefined;
  abort: () => void;
  hasPendingMessages: () => boolean;
  shutdown: () => void;
  getContextUsage: () => ContextUsage | undefined;
  compact: (options?: CompactOptions) => void;
  getSystemPrompt: () => string;
  getSystemPromptOptions?: () => BuildSystemPromptOptions;
  executeTool?: (
    callerId: string,
    name: string,
    args: unknown,
    options: ExecuteToolOptions,
  ) => Promise<agentTypes.AgentToolCallOutcome>;
  getCallableTools?: () => readonly agentTypes.AgentTool[];
}

export interface ExtensionCommandContextActions {
  waitForIdle: () => Promise<void>;
  newSession: (options?: {
    parentSession?: string;
    setup?: (sessionManager: SessionManager) => Promise<void>;
    withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
  }) => Promise<{ cancelled: boolean }>;
  fork: (
    entryId: string,
    options?: {
      position?: "before" | "at";
      withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
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
    options?: { withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
  ) => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
}

export interface ExtensionRuntime extends ExtensionRuntimeState, ExtensionActions {}
