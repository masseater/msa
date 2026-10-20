import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type compactionTypes from "../compaction/index.types.ts";
import type mcpServersTypes from "../mcp-servers.types.ts";
import type messagesTypes from "../messages.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import type systemPromptTypes from "../system-prompt.types.ts";
import type typesUiTypes from "./types-ui.ts";

declare namespace typesSessionEventsTypes {
  interface ProjectTrustEvent {
    type: "project_trust";
    cwd: string;
  }

  type ProjectTrustEventDecision = "yes" | "no" | "undecided";

  interface ProjectTrustEventResult {
    trusted: ProjectTrustEventDecision;
    remember?: boolean;
  }

  interface ProjectTrustContext {
    cwd: string;
    mode: typesUiTypes.ExtensionMode;
    hasUI: boolean;
    ui: Pick<typesUiTypes.ExtensionUIContext, "select" | "confirm" | "input" | "notify">;
  }

  type ProjectTrustHandler = (
    event: ProjectTrustEvent,
    ctx: ProjectTrustContext,
  ) => Promise<ProjectTrustEventResult> | ProjectTrustEventResult;

  interface ResourcesDiscoverEvent {
    type: "resources_discover";
    cwd: string;
    reason: "startup" | "reload";
  }

  interface ResourcesDiscoverResult {
    skillPaths?: string[];
    promptPaths?: string[];
    themePaths?: string[];
  }

  interface McpServersChangeEvent {
    type: "mcp_servers_change";
    servers: mcpServersTypes.RegisteredMcpServer[];
  }

  interface SessionStartEvent {
    type: "session_start";
    reason: "startup" | "reload" | "new" | "resume" | "fork";
    previousSessionFile?: string | undefined;
  }

  interface SessionInfoChangedEvent {
    type: "session_info_changed";
    name: string | undefined;
  }

  interface SessionBeforeSwitchEvent {
    type: "session_before_switch";
    reason: "new" | "resume";
    targetSessionFile?: string | undefined;
  }

  interface SessionBeforeForkEvent {
    type: "session_before_fork";
    entryId: string;
    position: "before" | "at";
  }

  interface SessionBeforeCompactEvent {
    type: "session_before_compact";
    preparation: compactionTypes.CompactionPreparation;
    branchEntries: sessionManagerTypes.SessionEntry[];
    customInstructions?: string | undefined;
    reason: "manual" | "threshold" | "overflow";
    willRetry: boolean;
    signal: AbortSignal;
  }

  interface SessionCompactEvent {
    type: "session_compact";
    compactionEntry: sessionManagerTypes.CompactionEntry;
    fromExtension: boolean;
    reason: "manual" | "threshold" | "overflow";
    willRetry: boolean;
  }

  interface SessionCompactFailedEvent {
    type: "session_compact_failed";
    reason: "manual" | "threshold" | "overflow";
    errorMessage?: string | undefined;
    aborted: boolean;
    willRetry: boolean;
    fromExtension: boolean;
  }

  interface SessionShutdownEvent {
    type: "session_shutdown";
    reason: "quit" | "reload" | "new" | "resume" | "fork";
    targetSessionFile?: string | undefined;
  }

  interface TreePreparation {
    targetId: string;
    oldLeafId: string | null;
    commonAncestorId: string | null;
    entriesToSummarize: sessionManagerTypes.SessionEntry[];
    userWantsSummary: boolean;
    customInstructions?: string | undefined;
    replaceInstructions?: boolean | undefined;
    label?: string | undefined;
  }

  interface SessionBeforeTreeEvent {
    type: "session_before_tree";
    preparation: TreePreparation;
    signal: AbortSignal;
  }

  interface SessionTreeEvent {
    type: "session_tree";
    newLeafId: string | null;
    oldLeafId: string | null;
    summaryEntry?: sessionManagerTypes.BranchSummaryEntry | undefined;
    fromExtension?: boolean | undefined;
  }

  type SessionEvent =
    | SessionStartEvent
    | SessionInfoChangedEvent
    | SessionBeforeSwitchEvent
    | SessionBeforeForkEvent
    | SessionBeforeCompactEvent
    | SessionCompactEvent
    | SessionCompactFailedEvent
    | SessionShutdownEvent
    | SessionBeforeTreeEvent
    | SessionTreeEvent;

  interface ContextEvent {
    type: "context";
    messages: agentTypes.AgentMessage[];
  }

  interface ContextWithSystemEvent {
    type: "context_with_system";
    messages: agentTypes.AgentMessage[];
  }

  interface BeforeProviderRequestEvent {
    type: "before_provider_request";
    payload: unknown;
  }

  interface BeforeProviderHeadersEvent {
    type: "before_provider_headers";
    headers: aiTypes.ProviderHeaders;
  }

  interface AfterProviderResponseEvent {
    type: "after_provider_response";
    status: number;
    headers: Record<string, string>;
  }

  interface ProviderStreamEvent {
    type: "provider_stream_event";
    provider: aiTypes.ProviderId;
    api: aiTypes.Api;
    model: string;
    data: unknown;
  }

  interface BeforeAgentStartEventBase {
    type: "before_agent_start";
    readonly systemPrompt: string;
    systemPromptOptions: systemPromptTypes.NormalizedBuildSystemPromptOptions;
  }

  interface BeforeAgentStartUserEvent extends BeforeAgentStartEventBase {
    messageType: "user";
    prompt: string;
    images?: aiTypes.ImageContent[] | undefined;
  }

  interface BeforeAgentStartCustomEvent extends BeforeAgentStartEventBase {
    messageType: "custom";
    message: messagesTypes.CustomMessage;
  }

  type BeforeAgentStartEvent = BeforeAgentStartUserEvent | BeforeAgentStartCustomEvent;

  interface AgentStartEvent {
    type: "agent_start";
  }

  interface AgentEndEvent {
    type: "agent_end";
    messages: agentTypes.AgentMessage[];
  }

  type AgentActivityOutcome = "completed" | "aborted" | "error";

  interface CustomEntryDraft {
    type: "custom";
    customType: string;
    data?: unknown;
  }

  interface CustomMessageEntryDraft {
    type: "custom_message";
    customType: string;
    content: string | (aiTypes.TextContent | aiTypes.ImageContent)[];
    display: boolean;
    details?: unknown;
  }

  interface ContextEditEntryDraft {
    type: "context_edit";
    targetId: string;
    replacement: sessionManagerTypes.ContextEditEntry["replacement"];
  }

  interface CompactionEntryDraft {
    type: "compaction";
    summary: string;
    firstKeptEntryId: string | null;
    details?: unknown;
    usage?: aiTypes.Usage;
  }

  type SessionBoundaryDraft =
    | CustomEntryDraft
    | CustomMessageEntryDraft
    | ContextEditEntryDraft
    | CompactionEntryDraft;

  interface BoundaryContextPreview {
    contextEntries: sessionManagerTypes.ProjectedSessionEntry[];
    contextMessages: agentTypes.AgentMessage[];
    llmMessages: aiTypes.Message[];
    pendingMessages: agentTypes.AgentMessage[];
    canContinue: boolean;
  }

  interface BoundaryState {
    entries: SessionBoundaryDraft[];
    continue: boolean;
    context: BoundaryContextPreview;
    outcome: AgentActivityOutcome;
  }

  interface BoundaryResult {
    entries?: SessionBoundaryDraft[];
    continue?: boolean;
  }

  interface AgentBeforeSettleEvent extends BoundaryState {
    type: "agent_before_settle";
  }

  interface AgentSettledEvent {
    type: "agent_settled";
    aborted: boolean;
  }

  type UIPromptKind = "select" | "confirm" | "input" | "editor" | "custom";

  interface UIPromptStartEvent {
    type: "ui_prompt_start";
    reason: "ui_prompt";
    kind: UIPromptKind;
    title?: string;
  }

  interface UIPromptEndEvent {
    type: "ui_prompt_end";
    reason: "ui_prompt";
    kind: UIPromptKind;
    title?: string;
  }
}

export type { typesSessionEventsTypes as default };
