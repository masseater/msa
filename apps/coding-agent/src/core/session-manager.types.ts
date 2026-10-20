import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type messagesTypes from "./messages.types.ts";
import type SessionManagerClass from "./session-manager.ts";

declare namespace sessionManagerTypes {
  interface SessionHeader {
    type: "session";
    version?: number | undefined;
    id: string;
    timestamp: string;
    cwd: string;
    parentSession?: string | undefined;
  }

  interface NewSessionOptions {
    id?: string | undefined;
    parentSession?: string | undefined;
  }

  interface SessionEntryBase {
    type: string;
    id: string;
    parentId: string | null;
    timestamp: string;
  }

  interface SessionMessageEntry extends SessionEntryBase {
    type: "message";
    message: agentTypes.AgentMessage;
  }

  interface ThinkingLevelChangeEntry extends SessionEntryBase {
    type: "thinking_level_change";
    thinkingLevel: string;
  }

  interface ModelChangeEntry extends SessionEntryBase {
    type: "model_change";
    provider: string;
    modelId: string;
  }

  interface UsageEntry extends SessionEntryBase {
    type: "usage";
    kind: string;
    provider: string;
    model: string;
    usage: aiTypes.Usage;
    note?: string;
  }

  interface CompactionEntry<T = unknown> extends SessionEntryBase {
    type: "compaction";
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: T | undefined;
    usage?: aiTypes.Usage | undefined;
    fromHook?: boolean | undefined;
    systemMessage?: aiTypes.SystemMessage | undefined;
  }

  interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
    type: "branch_summary";
    fromId: string;
    summary: string;
    details?: T | undefined;
    usage?: aiTypes.Usage | undefined;
    fromHook?: boolean | undefined;
  }

  interface CustomEntry<T = unknown> extends SessionEntryBase {
    type: "custom";
    customType: string;
    data?: T;
  }

  interface LabelEntry extends SessionEntryBase {
    type: "label";
    targetId: string;
    label: string | undefined;
  }

  interface SessionInfoEntry extends SessionEntryBase {
    type: "session_info";
    name?: string;
  }

  interface CustomMessageEntry<T = unknown> extends SessionEntryBase {
    type: "custom_message";
    customType: string;
    content: string | (aiTypes.TextContent | aiTypes.ImageContent)[];
    details?: T | undefined;
    display: boolean;
  }

  type ContextEditableContent =
    | aiTypes.UserMessage["content"]
    | aiTypes.AssistantMessage["content"]
    | aiTypes.ToolResultMessage["content"]
    | messagesTypes.CustomMessage["content"];

  interface ContextEditEntry extends SessionEntryBase {
    type: "context_edit";
    targetId: string;
    replacement: { content: ContextEditableContent } | null;
  }

  type SessionEntry =
    | SessionMessageEntry
    | ThinkingLevelChangeEntry
    | ModelChangeEntry
    | UsageEntry
    | CompactionEntry
    | BranchSummaryEntry
    | CustomEntry
    | CustomMessageEntry
    | ContextEditEntry
    | LabelEntry
    | SessionInfoEntry;

  type FileEntry = SessionHeader | SessionEntry;

  interface SessionTreeNode {
    entry: SessionEntry;
    children: SessionTreeNode[];
    label?: string | undefined;
    labelTimestamp?: string | undefined;
  }

  interface ProjectedSessionEntry {
    sourceEntry: SessionEntry;
    messages: agentTypes.AgentMessage[];
  }

  interface SessionProjection {
    entries: ProjectedSessionEntry[];
    messages: agentTypes.AgentMessage[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  }

  interface SessionContext {
    messages: agentTypes.AgentMessage[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  }

  interface SessionInfo {
    path: string;
    id: string;
    cwd: string;
    name?: string | undefined;
    parentSessionPath?: string | undefined;
    created: Date;
    modified: Date;
    messageCount: number;
    firstMessage: string;
    allMessagesText: string;
  }

  type ReadonlySessionManager = Pick<
    SessionManager,
    | "getCwd"
    | "getSessionDir"
    | "getSessionId"
    | "getSessionFile"
    | "getLeafId"
    | "getLeafEntry"
    | "getEntry"
    | "getLabel"
    | "getBranch"
    | "buildContextEntries"
    | "buildSessionProjection"
    | "getHeader"
    | "getEntries"
    | "getTree"
    | "getSessionName"
  >;

  type SessionListProgress = (
    loaded: number,
    total: number,
    partialSessions?: readonly SessionInfo[],
  ) => void;

  type SessionManager = (typeof SessionManagerClass)["prototype"];
}

export type { sessionManagerTypes as default };
