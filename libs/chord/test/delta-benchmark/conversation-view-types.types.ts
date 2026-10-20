import type { Draft } from "../../src/delta/draft.ts";
import type { JsonValue, Op } from "../../src/delta/index.ts";
import type conversationViewModelTypes from "./conversation-view-model.types.ts";
import type conversationViewModuleTypes from "./conversation-view-types.ts";

declare namespace conversationViewTypes {
  type MountedKey = (typeof conversationViewModuleTypes.MOUNTED_KEYS)[number];

  type DocumentKey = MountedKey | "audit";

  type JsonObject = Record<string, JsonValue>;

  type ConfigDoc = {
    schema: string;
    model: { provider: string; modelId: string };
    thinkingLevel: string;
    selectedTools: string[];
    sections: Array<{ id: string; title: string; instructions: string }>;
    tools: Array<{ name: string; description: string; inputSchema: JsonObject }>;
    temperature: number;
    revision: number;
  };

  type InboxItem = { id: number; mode: string; text: string };

  type InboxDoc = { schema: string; items: InboxItem[]; revision: number };

  type TurnDoc = {
    schema: string;
    stage: string;
    message: string;
    toolSlots: Array<{ callId: string; name: string; status: string; preview: string }>;
    revision: number;
  };

  type PreferencesDoc = {
    schema: string;
    theme: string;
    keymap: string;
    compactTools: boolean;
    fontScale: number;
    editorProfile: string;
    shortcuts: Record<string, string>;
    revision: number;
  };

  type LiveDoc = {
    schema: string;
    status: string;
    tokens: number;
    cost: number;
    heartbeat: number;
    generation: { stage: string; attempt: number; partial: string; retryAt?: number };
    tools: Array<{
      callId: string;
      name: string;
      status: string;
      progress: number;
      output: string;
    }>;
  };

  type AuditDoc = { schema: string; commits: number; note: string };

  type EntryKind = "user" | "assistant" | "tool-result" | "application";

  type TranscriptEntry = {
    id: number;
    parent: number | null;
    kind: EntryKind;
    data: JsonObject;
  };

  type ConversationView = {
    schema: string;
    conversation: { id: string; head: number | null };
    docs: Record<MountedKey, JsonObject>;
    entries: TranscriptEntry[];
  };

  type PreparedLike<T extends object> = {
    readonly base: T;
    readonly value: T;
    readonly ops: readonly Op[];
    abort(): void;
  };

  type ChangeLike<T extends object> = {
    readonly state: Draft<T>;
    prepare(): PreparedLike<T>;
    abort(): void;
  };

  type TrackerLike<T extends object> = {
    readonly value: T;
    beginChange(): ChangeLike<T>;
    adopt(prepared: PreparedLike<T>): void;
  };

  type DeltaFrame = {
    readonly kind: "delta";
    readonly sequence: number;
    readonly ops: readonly Op[];
  };

  type WatchType = "conversation" | "document";

  type Watch<T extends object> = {
    readonly snapshot: T;
    readonly baseSequence: number;
    readonly baseHash: string;
    deliveredSequence: number;
    pendingOperationCount: number;
    readonly queue: DeltaFrame[];
    readonly started: boolean;
    readonly watchType: WatchType;
  };

  type DocumentWatch = Watch<JsonObject> & { readonly key: DocumentKey };

  type DocumentWatchFrame = { readonly key: DocumentKey; readonly frame: DeltaFrame };

  type PhaseSamples = Record<conversationViewModelTypes.PhaseName, number[]>;

  type ScenarioConfig = {
    conversationWatchCount: 0 | 1 | 8;
    documentWatchCount: 0 | 4 | 16;
    started: boolean;
    queueCapacity: number | undefined;
  };

  type JsonDraft = Draft<JsonObject>;

  type DocMutation = {
    readonly key: DocumentKey;
    readonly mutate: (draft: JsonDraft) => void;
  };

  type CommitPlan = {
    readonly docs: readonly DocMutation[];
    readonly entryKind?: EntryKind | undefined;
    readonly branch?: boolean;
    readonly unmountedOnly: boolean;
    readonly expectedConversationNoop: boolean;
  };

  interface WorkerArguments {
    readonly mode: conversationViewModelTypes.Mode;
    readonly scenario: conversationViewModelTypes.Scenario;
    readonly headlineEntries: number;
    readonly commitTarget: number;
    readonly trial: number;
    readonly config: ScenarioConfig;
  }
}

export type { conversationViewTypes as default };
