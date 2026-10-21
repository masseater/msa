import type sessionManagerTypes from "../session-manager.types.ts";
import type systemPromptTypes from "../system-prompt.types.ts";
import type extensionsTypesTypes from "./types.types.ts";

declare namespace runnerTypesTypes {
  type BeforeAgentStartTrigger =
    | Pick<extensionsTypesTypes.BeforeAgentStartUserEvent, "messageType" | "prompt" | "images">
    | Pick<extensionsTypesTypes.BeforeAgentStartCustomEvent, "messageType" | "message">;

  interface BeforeAgentStartCombinedResult {
    messages: NonNullable<extensionsTypesTypes.BeforeAgentStartEventResult["message"]>[];
    systemPromptOptions: systemPromptTypes.NormalizedBuildSystemPromptOptions;
  }

  type RunnerEmitEvent = Exclude<
    extensionsTypesTypes.ExtensionEvent,
    | extensionsTypesTypes.ToolCallEvent
    | extensionsTypesTypes.ProjectTrustEvent
    | extensionsTypesTypes.ToolResultEvent
    | extensionsTypesTypes.UserBashEvent
    | extensionsTypesTypes.ContextEvent
    | extensionsTypesTypes.ContextWithSystemEvent
    | extensionsTypesTypes.CacheWarmingDecisionEvent
    | extensionsTypesTypes.BeforeProviderRequestEvent
    | extensionsTypesTypes.BeforeProviderHeadersEvent
    | extensionsTypesTypes.BeforeAgentStartEvent
    | extensionsTypesTypes.MessageEndEvent
    | extensionsTypesTypes.ResourcesDiscoverEvent
    | extensionsTypesTypes.InputEvent
    | extensionsTypesTypes.TurnEndEvent
    | extensionsTypesTypes.AgentBeforeSettleEvent
  >;

  type SessionBeforeEvent = Extract<
    RunnerEmitEvent,
    {
      type:
        | "session_before_switch"
        | "session_before_fork"
        | "session_before_compact"
        | "session_before_tree";
    }
  >;

  type SessionBeforeEventResult =
    | extensionsTypesTypes.SessionBeforeSwitchResult
    | extensionsTypesTypes.SessionBeforeForkResult
    | extensionsTypesTypes.SessionBeforeCompactResult
    | extensionsTypesTypes.SessionBeforeTreeResult;

  type RunnerEmitResult<TEvent extends RunnerEmitEvent> = TEvent extends {
    type: "session_before_switch";
  }
    ? extensionsTypesTypes.SessionBeforeSwitchResult | undefined
    : TEvent extends { type: "session_before_fork" }
      ? extensionsTypesTypes.SessionBeforeForkResult | undefined
      : TEvent extends { type: "session_before_compact" }
        ? extensionsTypesTypes.SessionBeforeCompactResult | undefined
        : TEvent extends { type: "session_before_tree" }
          ? extensionsTypesTypes.SessionBeforeTreeResult | undefined
          : undefined;

  type ExtensionErrorListener = (error: extensionsTypesTypes.ExtensionError) => void;

  type BoundaryBaseEvent =
    | Omit<extensionsTypesTypes.TurnEndEvent, "entries" | "continue" | "context">
    | Omit<extensionsTypesTypes.AgentBeforeSettleEvent, "entries" | "continue" | "context">;

  interface BoundaryDispatchResult {
    entries: extensionsTypesTypes.SessionBoundaryDraft[];
    continue: boolean;
    context: extensionsTypesTypes.BoundaryContextPreview;
    valid: boolean;
  }

  type NewSessionHandler = (options?: {
    parentSession?: string;
    setup?: (sessionManager: sessionManagerTypes.SessionManager) => Promise<void>;
    withSession?: (ctx: extensionsTypesTypes.ReplacedSessionContext) => Promise<void>;
  }) => Promise<{ cancelled: boolean }>;

  type ForkHandler = (
    entryId: string,
    options?: {
      position?: "before" | "at";
      withSession?: (ctx: extensionsTypesTypes.ReplacedSessionContext) => Promise<void>;
    },
  ) => Promise<{ cancelled: boolean }>;

  type NavigateTreeHandler = (
    targetId: string,
    options?: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    },
  ) => Promise<{ cancelled: boolean }>;

  type SwitchSessionHandler = (
    sessionPath: string,
    options?: { withSession?: (ctx: extensionsTypesTypes.ReplacedSessionContext) => Promise<void> },
  ) => Promise<{ cancelled: boolean }>;

  type ReloadHandler = () => Promise<void>;

  type ShutdownHandler = () => void;
}

export type { runnerTypesTypes as default };
