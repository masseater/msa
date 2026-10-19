import type { SessionManager } from "../session-manager.ts";
import type { NormalizedBuildSystemPromptOptions } from "../system-prompt.ts";
import type {
  AgentBeforeSettleEvent,
  BeforeAgentStartCustomEvent,
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  BeforeAgentStartUserEvent,
  BeforeProviderHeadersEvent,
  BeforeProviderRequestEvent,
  BoundaryContextPreview,
  CacheWarmingDecisionEvent,
  ContextEvent,
  ContextWithSystemEvent,
  ExtensionError,
  ExtensionEvent,
  InputEvent,
  MessageEndEvent,
  ProjectTrustEvent,
  ReplacedSessionContext,
  ResourcesDiscoverEvent,
  SessionBeforeCompactResult,
  SessionBeforeForkResult,
  SessionBeforeSwitchResult,
  SessionBeforeTreeResult,
  SessionBoundaryDraft,
  ToolCallEvent,
  ToolResultEvent,
  TurnEndEvent,
  UserBashEvent,
} from "./types.ts";

export type BeforeAgentStartTrigger =
  | Pick<BeforeAgentStartUserEvent, "messageType" | "prompt" | "images">
  | Pick<BeforeAgentStartCustomEvent, "messageType" | "message">;

export interface BeforeAgentStartCombinedResult {
  messages: NonNullable<BeforeAgentStartEventResult["message"]>[];
  systemPromptOptions: NormalizedBuildSystemPromptOptions;
}

export type RunnerEmitEvent = Exclude<
  ExtensionEvent,
  | ToolCallEvent
  | ProjectTrustEvent
  | ToolResultEvent
  | UserBashEvent
  | ContextEvent
  | ContextWithSystemEvent
  | CacheWarmingDecisionEvent
  | BeforeProviderRequestEvent
  | BeforeProviderHeadersEvent
  | BeforeAgentStartEvent
  | MessageEndEvent
  | ResourcesDiscoverEvent
  | InputEvent
  | TurnEndEvent
  | AgentBeforeSettleEvent
>;

export type SessionBeforeEvent = Extract<
  RunnerEmitEvent,
  {
    type:
      | "session_before_switch"
      | "session_before_fork"
      | "session_before_compact"
      | "session_before_tree";
  }
>;

export type SessionBeforeEventResult =
  | SessionBeforeSwitchResult
  | SessionBeforeForkResult
  | SessionBeforeCompactResult
  | SessionBeforeTreeResult;

export type RunnerEmitResult<TEvent extends RunnerEmitEvent> = TEvent extends {
  type: "session_before_switch";
}
  ? SessionBeforeSwitchResult | undefined
  : TEvent extends { type: "session_before_fork" }
    ? SessionBeforeForkResult | undefined
    : TEvent extends { type: "session_before_compact" }
      ? SessionBeforeCompactResult | undefined
      : TEvent extends { type: "session_before_tree" }
        ? SessionBeforeTreeResult | undefined
        : undefined;

export type ExtensionErrorListener = (error: ExtensionError) => void;

export type BoundaryBaseEvent =
  | Omit<TurnEndEvent, "entries" | "continue" | "context">
  | Omit<AgentBeforeSettleEvent, "entries" | "continue" | "context">;

export interface BoundaryDispatchResult {
  entries: SessionBoundaryDraft[];
  continue: boolean;
  context: BoundaryContextPreview;
  valid: boolean;
}

export type NewSessionHandler = (options?: {
  parentSession?: string;
  setup?: (sessionManager: SessionManager) => Promise<void>;
  withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
}) => Promise<{ cancelled: boolean }>;

export type ForkHandler = (
  entryId: string,
  options?: {
    position?: "before" | "at";
    withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
  },
) => Promise<{ cancelled: boolean }>;

export type NavigateTreeHandler = (
  targetId: string,
  options?: {
    summarize?: boolean;
    customInstructions?: string;
    replaceInstructions?: boolean;
    label?: string;
  },
) => Promise<{ cancelled: boolean }>;

export type SwitchSessionHandler = (
  sessionPath: string,
  options?: { withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
) => Promise<{ cancelled: boolean }>;

export type ReloadHandler = () => Promise<void>;

export type ShutdownHandler = () => void;
