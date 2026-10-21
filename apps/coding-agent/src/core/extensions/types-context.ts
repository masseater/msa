import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type messagesTypes from "../messages.types.ts";
import type modelRegistryTypes from "../model-registry.types.ts";
import type modelResolverTypes from "../model-resolver.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import type systemPromptTypes from "../system-prompt.types.ts";
import type typesUiTypes from "./types-ui.ts";

declare namespace typesContextTypes {
  interface ExtensionContext {
    ui: typesUiTypes.ExtensionUIContext;
    mode: typesUiTypes.ExtensionMode;
    hasUI: boolean;
    cwd: string;
    sessionManager: sessionManagerTypes.ReadonlySessionManager;
    modelRegistry: modelRegistryTypes.ModelRegistry;
    model: aiTypes.Model<any> | undefined;
    scopedModels: readonly modelResolverTypes.ScopedModel[];
    thinkingLevel?: agentTypes.ThinkingLevel;
    isIdle(): boolean;
    isProjectTrusted(): boolean;
    signal: AbortSignal | undefined;
    abort(): void;
    hasPendingMessages(): boolean;
    shutdown(): void;
    getContextUsage(): typesUiTypes.ContextUsage | undefined;
    compact(options?: typesUiTypes.CompactOptions): void;
    getSystemPrompt(): string;
  }

  interface ExecuteToolOptions {
    signal?: AbortSignal | undefined;
    onUpdate?: agentTypes.AgentToolUpdateCallback | undefined;
  }

  interface ExtensionToolContext extends ExtensionContext {
    readonly tools: readonly agentTypes.AgentTool[];
    executeTool(
      name: string,
      args: unknown,
      options?: ExecuteToolOptions,
    ): Promise<agentTypes.AgentToolCallOutcome>;
  }

  interface ExtensionCommandContext extends ExtensionContext {
    getSystemPromptOptions(): systemPromptTypes.BuildSystemPromptOptions;

    waitForIdle(): Promise<void>;

    newSession(options?: {
      parentSession?: string;
      setup?: (sessionManager: sessionManagerTypes.SessionManager) => Promise<void>;
      withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
    }): Promise<{ cancelled: boolean }>;

    fork(
      entryId: string,
      options?: {
        position?: "before" | "at";
        withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
      },
    ): Promise<{ cancelled: boolean }>;

    navigateTree(
      targetId: string,
      options?: {
        summarize?: boolean;
        customInstructions?: string;
        replaceInstructions?: boolean;
        label?: string;
      },
    ): Promise<{ cancelled: boolean }>;

    switchSession(
      sessionPath: string,
      options?: { withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
    ): Promise<{ cancelled: boolean }>;

    reload(): Promise<void>;
  }

  interface ReplacedSessionContext extends ExtensionCommandContext {
    sendMessage<T = unknown>(
      message: Pick<
        messagesTypes.CustomMessage<T>,
        "customType" | "content" | "display" | "details"
      >,
      options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
    ): Promise<void>;

    sendUserMessage(
      content: string | (aiTypes.TextContent | aiTypes.ImageContent)[],
      options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean },
    ): Promise<void>;
  }
}

export type { typesContextTypes as default };
