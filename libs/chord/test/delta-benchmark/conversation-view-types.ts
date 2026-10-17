import type { Draft } from "../../src/delta/draft.ts";
import type { JsonValue, Op } from "../../src/delta/index.ts";
import {
  type Mode,
  modes,
  type PhaseName,
  type Scenario,
  scenarios,
} from "./conversation-view-model.ts";

export const MiB = 1024 * 1024;
export const MOUNTED_KEYS = ["config", "inbox", "turn", "preferences", "live"] as const;
export const DOCUMENT_WATCH_KEYS = ["config", "inbox", "preferences", "live"] as const;

export type MountedKey = (typeof MOUNTED_KEYS)[number];
export type DocumentKey = MountedKey | "audit";
export type JsonObject = Record<string, JsonValue>;
export type ConfigDoc = {
  schema: string;
  model: { provider: string; modelId: string };
  thinkingLevel: string;
  selectedTools: string[];
  sections: Array<{ id: string; title: string; instructions: string }>;
  tools: Array<{ name: string; description: string; inputSchema: JsonObject }>;
  temperature: number;
  revision: number;
};
export type InboxItem = { id: number; mode: string; text: string };
export type InboxDoc = { schema: string; items: InboxItem[]; revision: number };
export type TurnDoc = {
  schema: string;
  stage: string;
  message: string;
  toolSlots: Array<{ callId: string; name: string; status: string; preview: string }>;
  revision: number;
};
export type PreferencesDoc = {
  schema: string;
  theme: string;
  keymap: string;
  compactTools: boolean;
  fontScale: number;
  editorProfile: string;
  shortcuts: Record<string, string>;
  revision: number;
};
export type LiveDoc = {
  schema: string;
  status: string;
  tokens: number;
  cost: number;
  heartbeat: number;
  generation: { stage: string; attempt: number; partial: string; retryAt?: number };
  tools: Array<{ callId: string; name: string; status: string; progress: number; output: string }>;
};
export type AuditDoc = { schema: string; commits: number; note: string };
export type EntryKind = "user" | "assistant" | "tool-result" | "application";
export type TranscriptEntry = {
  id: number;
  parent: number | null;
  kind: EntryKind;
  data: JsonObject;
};
export type ConversationView = {
  schema: string;
  conversation: { id: string; head: number | null };
  docs: Record<MountedKey, JsonObject>;
  entries: TranscriptEntry[];
};
export type PreparedLike<T extends object> = {
  readonly base: T;
  readonly value: T;
  readonly ops: readonly Op[];
  abort(): void;
};
export type ChangeLike<T extends object> = {
  readonly state: Draft<T>;
  prepare(): PreparedLike<T>;
  abort(): void;
};
export type TrackerLike<T extends object> = {
  readonly value: T;
  beginChange(): ChangeLike<T>;
  adopt(prepared: PreparedLike<T>): void;
};
export type DeltaFrame = {
  readonly kind: "delta";
  readonly sequence: number;
  readonly ops: readonly Op[];
};
export type WatchType = "conversation" | "document";
export type Watch<T extends object> = {
  readonly snapshot: T;
  readonly baseSequence: number;
  readonly baseHash: string;
  deliveredSequence: number;
  pendingOperationCount: number;
  readonly queue: DeltaFrame[];
  readonly started: boolean;
  readonly watchType: WatchType;
};
export type DocumentWatch = Watch<JsonObject> & { readonly key: DocumentKey };
export type DocumentWatchFrame = { readonly key: DocumentKey; readonly frame: DeltaFrame };
export type PhaseSamples = Record<PhaseName, number[]>;
export type ScenarioConfig = {
  conversationWatchCount: 0 | 1 | 8;
  documentWatchCount: 0 | 4 | 16;
  started: boolean;
  queueCapacity: number | undefined;
};
export type JsonDraft = Draft<JsonObject>;
export type DocMutation = {
  readonly key: DocumentKey;
  readonly mutate: (draft: JsonDraft) => void;
};
export type CommitPlan = {
  readonly docs: readonly DocMutation[];
  readonly entryKind?: EntryKind | undefined;
  readonly branch?: boolean;
  readonly unmountedOnly: boolean;
  readonly expectedConversationNoop: boolean;
};

export interface WorkerArguments {
  readonly mode: Mode;
  readonly scenario: Scenario;
  readonly headlineEntries: number;
  readonly commitTarget: number;
  readonly trial: number;
  readonly config: ScenarioConfig;
}

const standard: ScenarioConfig = {
  conversationWatchCount: 1,
  documentWatchCount: 4,
  started: true,
  queueCapacity: undefined,
};

const scenarioConfig = (name: Scenario, overflowCapacity: number): ScenarioConfig => {
  switch (name) {
    case "projection-control":
      return { ...standard, conversationWatchCount: 0, documentWatchCount: 0 };
    case "normal":
    case "churn-reconnect":
      return standard;
    case "fanout":
      return { ...standard, conversationWatchCount: 8, documentWatchCount: 16 };
    case "delayed-start-lag":
    case "branch-head-replacement":
      return { ...standard, started: false };
    case "overflow-reset":
      return { ...standard, started: false, queueCapacity: overflowCapacity };
  }
};

const isMode = (value: string | undefined): value is Mode =>
  (modes as readonly (string | undefined)[]).includes(value);

const isScenario = (value: string | undefined): value is Scenario =>
  (scenarios as readonly (string | undefined)[]).includes(value);

const positive = (value: number, message: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(message);
  return value;
};

export const parseWorkerArguments = (argv: readonly string[]): WorkerArguments => {
  const [mode, scenario] = [argv[2], argv[3]];
  if (!isMode(mode)) throw new Error(`Unknown mode ${mode}`);
  if (!isScenario(scenario)) throw new Error(`Unknown scenario ${scenario}`);
  const headlineEntries = positive(Number(argv[4] ?? 512), "Invalid entry count");
  const commitTarget = positive(Number(argv[5] ?? 1_000), "Invalid commit count");
  const trial = Number(argv[6] ?? 0);
  const capacity = positive(Number(argv[7] ?? 256), "Invalid queue operation capacity");
  return {
    mode,
    scenario,
    headlineEntries,
    commitTarget,
    trial,
    config: scenarioConfig(scenario, capacity),
  };
};
