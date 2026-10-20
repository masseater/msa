import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type { CompactionPreparation } from "../compaction/index.ts";
import type { RegisteredMcpServer } from "../mcp-servers.ts";
import type { CustomMessage } from "../messages.ts";
import type {
  BranchSummaryEntry,
  CompactionEntry,
  ContextEditEntry,
  ProjectedSessionEntry,
  SessionEntry,
} from "../session-manager.ts";
import type { NormalizedBuildSystemPromptOptions } from "../system-prompt.ts";
import type { ExtensionMode, ExtensionUIContext } from "./types-ui.ts";

export interface ProjectTrustEvent {
  type: "project_trust";
  cwd: string;
}

export type ProjectTrustEventDecision = "yes" | "no" | "undecided";

export interface ProjectTrustEventResult {
  trusted: ProjectTrustEventDecision;
  remember?: boolean;
}

export interface ProjectTrustContext {
  cwd: string;
  mode: ExtensionMode;
  hasUI: boolean;
  ui: Pick<ExtensionUIContext, "select" | "confirm" | "input" | "notify">;
}

export type ProjectTrustHandler = (
  event: ProjectTrustEvent,
  ctx: ProjectTrustContext,
) => Promise<ProjectTrustEventResult> | ProjectTrustEventResult;

export interface ResourcesDiscoverEvent {
  type: "resources_discover";
  cwd: string;
  reason: "startup" | "reload";
}

export interface ResourcesDiscoverResult {
  skillPaths?: string[];
  promptPaths?: string[];
  themePaths?: string[];
}

export interface McpServersChangeEvent {
  type: "mcp_servers_change";
  servers: RegisteredMcpServer[];
}

export interface SessionStartEvent {
  type: "session_start";
  reason: "startup" | "reload" | "new" | "resume" | "fork";
  previousSessionFile?: string | undefined;
}

export interface SessionInfoChangedEvent {
  type: "session_info_changed";
  name: string | undefined;
}

export interface SessionBeforeSwitchEvent {
  type: "session_before_switch";
  reason: "new" | "resume";
  targetSessionFile?: string | undefined;
}

export interface SessionBeforeForkEvent {
  type: "session_before_fork";
  entryId: string;
  position: "before" | "at";
}

export interface SessionBeforeCompactEvent {
  type: "session_before_compact";
  preparation: CompactionPreparation;
  branchEntries: SessionEntry[];
  customInstructions?: string | undefined;
  reason: "manual" | "threshold" | "overflow";
  willRetry: boolean;
  signal: AbortSignal;
}

export interface SessionCompactEvent {
  type: "session_compact";
  compactionEntry: CompactionEntry;
  fromExtension: boolean;
  reason: "manual" | "threshold" | "overflow";
  willRetry: boolean;
}

export interface SessionCompactFailedEvent {
  type: "session_compact_failed";
  reason: "manual" | "threshold" | "overflow";
  errorMessage?: string | undefined;
  aborted: boolean;
  willRetry: boolean;
  fromExtension: boolean;
}

export interface SessionShutdownEvent {
  type: "session_shutdown";
  reason: "quit" | "reload" | "new" | "resume" | "fork";
  targetSessionFile?: string | undefined;
}

export interface TreePreparation {
  targetId: string;
  oldLeafId: string | null;
  commonAncestorId: string | null;
  entriesToSummarize: SessionEntry[];
  userWantsSummary: boolean;
  customInstructions?: string | undefined;
  replaceInstructions?: boolean | undefined;
  label?: string | undefined;
}

export interface SessionBeforeTreeEvent {
  type: "session_before_tree";
  preparation: TreePreparation;
  signal: AbortSignal;
}

export interface SessionTreeEvent {
  type: "session_tree";
  newLeafId: string | null;
  oldLeafId: string | null;
  summaryEntry?: BranchSummaryEntry | undefined;
  fromExtension?: boolean | undefined;
}

export type SessionEvent =
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

export interface ContextEvent {
  type: "context";
  messages: agentTypes.AgentMessage[];
}

export interface ContextWithSystemEvent {
  type: "context_with_system";
  messages: agentTypes.AgentMessage[];
}

export interface BeforeProviderRequestEvent {
  type: "before_provider_request";
  payload: unknown;
}

export interface BeforeProviderHeadersEvent {
  type: "before_provider_headers";
  headers: aiTypes.ProviderHeaders;
}

export interface AfterProviderResponseEvent {
  type: "after_provider_response";
  status: number;
  headers: Record<string, string>;
}

export interface ProviderStreamEvent {
  type: "provider_stream_event";
  provider: aiTypes.ProviderId;
  api: aiTypes.Api;
  model: string;
  data: unknown;
}

interface BeforeAgentStartEventBase {
  type: "before_agent_start";
  readonly systemPrompt: string;
  systemPromptOptions: NormalizedBuildSystemPromptOptions;
}

export interface BeforeAgentStartUserEvent extends BeforeAgentStartEventBase {
  messageType: "user";
  prompt: string;
  images?: aiTypes.ImageContent[] | undefined;
}

export interface BeforeAgentStartCustomEvent extends BeforeAgentStartEventBase {
  messageType: "custom";
  message: CustomMessage;
}

export type BeforeAgentStartEvent = BeforeAgentStartUserEvent | BeforeAgentStartCustomEvent;

export interface AgentStartEvent {
  type: "agent_start";
}

export interface AgentEndEvent {
  type: "agent_end";
  messages: agentTypes.AgentMessage[];
}

export type AgentActivityOutcome = "completed" | "aborted" | "error";

export interface CustomEntryDraft {
  type: "custom";
  customType: string;
  data?: unknown;
}

export interface CustomMessageEntryDraft {
  type: "custom_message";
  customType: string;
  content: string | (aiTypes.TextContent | aiTypes.ImageContent)[];
  display: boolean;
  details?: unknown;
}

export interface ContextEditEntryDraft {
  type: "context_edit";
  targetId: string;
  replacement: ContextEditEntry["replacement"];
}

export interface CompactionEntryDraft {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string | null;
  details?: unknown;
  usage?: aiTypes.Usage;
}

export type SessionBoundaryDraft =
  | CustomEntryDraft
  | CustomMessageEntryDraft
  | ContextEditEntryDraft
  | CompactionEntryDraft;

export interface BoundaryContextPreview {
  contextEntries: ProjectedSessionEntry[];
  contextMessages: agentTypes.AgentMessage[];
  llmMessages: aiTypes.Message[];
  pendingMessages: agentTypes.AgentMessage[];
  canContinue: boolean;
}

export interface BoundaryState {
  entries: SessionBoundaryDraft[];
  continue: boolean;
  context: BoundaryContextPreview;
  outcome: AgentActivityOutcome;
}

export interface BoundaryResult {
  entries?: SessionBoundaryDraft[];
  continue?: boolean;
}

export interface AgentBeforeSettleEvent extends BoundaryState {
  type: "agent_before_settle";
}

export interface AgentSettledEvent {
  type: "agent_settled";
  aborted: boolean;
}

export type UIPromptKind = "select" | "confirm" | "input" | "editor" | "custom";

export interface UIPromptStartEvent {
  type: "ui_prompt_start";
  reason: "ui_prompt";
  kind: UIPromptKind;
  title?: string;
}

export interface UIPromptEndEvent {
  type: "ui_prompt_end";
  reason: "ui_prompt";
  kind: UIPromptKind;
  title?: string;
}
