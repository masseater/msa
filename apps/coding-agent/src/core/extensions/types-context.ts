import type {
  AgentTool,
  AgentToolCallOutcome,
  AgentToolUpdateCallback,
  ThinkingLevel,
} from "@msa/agent-core";
import type { ImageContent, Model, TextContent } from "@msa/ai";

import type { CustomMessage } from "../messages.ts";
import type { ModelRegistry } from "../model-registry.ts";
import type { ScopedModel } from "../model-resolver.ts";
import type { ReadonlySessionManager, SessionManager } from "../session-manager.ts";
import type { BuildSystemPromptOptions } from "../system-prompt.ts";
import type {
  CompactOptions,
  ContextUsage,
  ExtensionMode,
  ExtensionUIContext,
} from "./types-ui.ts";

export interface ExtensionContext {
  ui: ExtensionUIContext;
  mode: ExtensionMode;
  hasUI: boolean;
  cwd: string;
  sessionManager: ReadonlySessionManager;
  modelRegistry: ModelRegistry;
  model: Model<any> | undefined;
  scopedModels: readonly ScopedModel[];
  thinkingLevel?: ThinkingLevel;
  isIdle(): boolean;
  isProjectTrusted(): boolean;
  signal: AbortSignal | undefined;
  abort(): void;
  hasPendingMessages(): boolean;
  shutdown(): void;
  getContextUsage(): ContextUsage | undefined;
  compact(options?: CompactOptions): void;
  getSystemPrompt(): string;
}

export interface ExecuteToolOptions {
  signal?: AbortSignal | undefined;
  onUpdate?: AgentToolUpdateCallback | undefined;
}

export interface ExtensionToolContext extends ExtensionContext {
  readonly tools: readonly AgentTool[];
  executeTool(
    name: string,
    args: unknown,
    options?: ExecuteToolOptions,
  ): Promise<AgentToolCallOutcome>;
}

export interface ExtensionCommandContext extends ExtensionContext {
  getSystemPromptOptions(): BuildSystemPromptOptions;

  waitForIdle(): Promise<void>;

  newSession(options?: {
    parentSession?: string;
    setup?: (sessionManager: SessionManager) => Promise<void>;
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

export interface ReplacedSessionContext extends ExtensionCommandContext {
  sendMessage<T = unknown>(
    message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): Promise<void>;

  sendUserMessage(
    content: string | (TextContent | ImageContent)[],
    options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean },
  ): Promise<void>;
}
