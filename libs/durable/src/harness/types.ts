import type { CacheRetention, Message, Models, Transport, UserMessage } from "@msa/ai";
import type { AttachedReplicatedState, Context, JsonValue } from "@msa/chord";

import type { ExecutionEnv } from "../env/index.ts";
import type {
  ConversationId,
  ConversationOwnership,
  ConversationRecord,
  Cursor,
  DocumentReader,
  EntryDraft,
  EntryId,
  EntryQuery,
  EntryRecord,
  JsonObject,
  Page,
  Session,
  SubmissionId,
  SubmissionRecord,
  Task,
  TaskId,
  TaskRecord,
  TaskState,
  Tx,
  WatchHandle,
} from "../types.ts";
import type { TaskGraph, TaskGraphWatch } from "./task-graph.ts";
import type { Agent, AgentChange, Extension, RegistryReader } from "./types-registry.ts";
import type { QueueMode, ToolExecutionMode, ToolRegistration } from "./types-tools.ts";
import type { UsageState } from "./usage.ts";
import type { ConversationView } from "./view.ts";

export type * from "./types-tools.ts";
export type * from "./types-registry.ts";
export type * from "./types-hooks.ts";
export type * from "../types.ts";

export type ModelRef = {
  readonly provider: string;
  readonly modelId: string;
};

export type UserInput = UserMessage["content"];

export type InputEntry = { readonly kind: string; readonly data?: JsonValue };

export type SubmissionDraft = {
  readonly requestId?: string;
} & (
  | {
      readonly type: "input";
      readonly content: UserInput;
      readonly whenBusy?: "steer" | "followUp" | "reject";
      readonly entry?: InputEntry;
    }
  | {
      readonly type: "write";
      readonly entry: EntryDraft;
      readonly content?: never;
      readonly whenBusy?: never;
    }
);

export type InputSubmissionDraft = Extract<SubmissionDraft, { readonly type: "input" }>;

export type SettledSubmissionRecord = SubmissionRecord & {
  readonly status: "done" | "unanswered";
};

export interface Submission {
  readonly id: SubmissionId;
  status(context: Context): Promise<SubmissionRecord>;
  wait(context: Context): Promise<SettledSubmissionRecord>;
  abort(context: Context): Promise<"aborted" | "already_placed" | "settled">;
}

export type SettledTask<R> = TaskRecord<JsonValue, JsonValue, R> & {
  readonly state: Extract<TaskState<JsonValue, R>, { readonly status: "terminal" }>;
};

export type AnyTask = {
  readonly definition: {
    readonly name: string;
    readonly version: number;
    readonly initial: unknown;
    readonly phases: Readonly<Record<string, unknown>>;
    readonly abort: unknown;
    readonly migrate?: unknown;
    readonly hooks?: object;
  };
};

export type ConversationAbortOptions = {
  readonly background?: boolean;
};

export type HooksOf<K> = K extends Task<infer _I, infer _S, infer _R, infer H> ? H : never;

export interface ConversationHandle {
  readonly id: ConversationId;
  submit(submission: InputSubmissionDraft, context: Context): Promise<Submission>;
  abort(context: Context, options?: ConversationAbortOptions): Promise<void>;
  waitForIdle(context: Context): Promise<void>;
}

export type ConversationInit = (tx: Tx, conversationId: ConversationId) => void | Promise<void>;

export type ConversationCreateOptions = {
  readonly ownership: ConversationOwnership;
  readonly agent?: AgentChange;
  readonly init?: ConversationInit;
};

export type ConversationStreamOptions = {
  transport?: Transport;
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  headers?: Record<string, string>;
  metadata?: JsonObject;
  cacheRetention?: CacheRetention;
  deferred?: boolean | { window?: "15m" | "1h" | "24h" };
};

export type ConversationRetryPolicy = {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxAgentDelayMs?: number;
};

export type CompactionPolicy = {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
  backgroundTokens: number;
};

export type ProgressPolicy = {
  partialIntervalMs: number;
  outputIntervalMs: number;
};

export type CompactionReason = "manual" | "threshold" | "overflow";

export type CompactionResult = { entryId?: EntryId; submissionId?: SubmissionId };

export type HarnessSettings = {
  readonly extensions?: readonly Extension[] | undefined;
  readonly stream?: ConversationStreamOptions;
  readonly retry?: Partial<ConversationRetryPolicy>;
  readonly compaction?: Partial<CompactionPolicy>;
  readonly progress?: { readonly [K in keyof ProgressPolicy]?: ProgressPolicy[K] | undefined };
  readonly toolExecution?: ToolExecutionMode;
  readonly steeringMode?: QueueMode;
  readonly followUpMode?: QueueMode;
  readonly contextRetentionMs?: number;
  readonly documentRetentionMs?: number;
};

export type Settings = {
  readonly extensions?: readonly Extension[];
  readonly stream: ConversationStreamOptions;
  readonly retry: ConversationRetryPolicy;
  readonly compaction: CompactionPolicy;
  readonly progress: ProgressPolicy;
  readonly toolExecution: ToolExecutionMode;
  readonly steeringMode: QueueMode;
  readonly followUpMode: QueueMode;
  readonly contextRetentionMs: number;
  readonly documentRetentionMs: number;
};

export type EnvTarget = {
  readonly conversationId: ConversationId;
  readonly cwd?: string;
  readonly read: DocumentReader;
};

export type HarnessOptions<Tool extends ToolRegistration = ToolRegistration> = {
  readonly models: Models;
  readonly registry: RegistryReader<Tool>;
  readonly settings?: HarnessSettings;
  readonly env?: (
    target: EnvTarget,
    context: Context,
  ) => ExecutionEnv | undefined | Promise<ExecutionEnv | undefined>;
  readonly conversationCreated?: (tx: Tx, conversation: ConversationRecord) => void | Promise<void>;
  readonly now?: () => number;
  readonly onReport?: (error: unknown) => void;
};

export type TaskInspection = {
  readonly record: TaskRecord<JsonValue, JsonValue, JsonValue>;
  readonly state: TaskInspectionState;
};

type TaskInspectionState =
  | { readonly kind: "running" }
  | { readonly kind: "ready"; readonly migrates: boolean }
  | { readonly kind: "waiting"; readonly on: readonly TaskId[] }
  | { readonly kind: "completing" }
  | {
      readonly kind: "blocked";
      readonly reason: "missing_task" | "task_too_old" | "migration_failed";
      readonly error?: unknown;
    };

export type HarnessInspection = {
  readonly scheduling: "paused" | "running" | "closing";
  readonly tasks: readonly TaskInspection[];
  readonly submissions: readonly SubmissionRecord[];
};

export type ContextView = {
  readonly head: EntryRecord | undefined;
  readonly entries: readonly EntryRecord[];
  readonly contributions: readonly (readonly Message[])[];
  readonly messages: readonly Message[];
};

export interface Conversation {
  readonly id: ConversationId;

  agent(context: Context): Promise<Agent>;
  configure(change: AgentChange, context: Context): Promise<void>;

  submit(submission: SubmissionDraft, context: Context): Promise<Submission>;
  reset(handoff: string | undefined, context: Context): Promise<void>;
  compact(instructions: string | undefined, context: Context): Promise<TaskId<CompactionResult>>;

  commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T>;
  context(context: Context, options?: { readonly at?: EntryId }): Promise<ContextView>;
  entries(
    query: Omit<EntryQuery, "conversationId">,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<EntryRecord, Cursor>>;
  fork(at: EntryId, options: ConversationCreateOptions, context: Context): Promise<Conversation>;
  abort(context: Context, options?: ConversationAbortOptions): Promise<void>;
  waitForIdle(context: Context): Promise<void>;
  viewState(context: Context): Promise<AttachedReplicatedState<ConversationView>>;
  watch(context: Context): Promise<ConversationWatch>;
}

export type ConversationWatch = WatchHandle<ConversationView>;

export interface Harness extends Session {
  resume(): void;

  root(
    context: Context,
    options?: { readonly agent?: AgentChange; readonly init?: ConversationInit },
  ): Promise<Conversation>;
  conversation(id: ConversationId, context: Context): Promise<Conversation | undefined>;
  createConversation(options: ConversationCreateOptions, context: Context): Promise<Conversation>;

  getTask<R>(
    id: TaskId<R>,
    context: Context,
  ): Promise<TaskRecord<JsonValue, JsonValue, R> | undefined>;
  inspect(context: Context): Promise<HarnessInspection>;
  submission(id: SubmissionId, context: Context): Promise<Submission | undefined>;
  abortSubmission(
    id: SubmissionId,
    context: Context,
    conversationId?: ConversationId,
  ): Promise<"aborted" | "already_placed" | "settled" | "not_found">;
  abortTask(id: TaskId, context: Context): Promise<"marked" | "terminal">;
  waitForTask<R>(id: TaskId<R>, context: Context): Promise<SettledTask<R>>;
  waitForIdle(context: Context): Promise<void>;
  usage(context: Context): Promise<UsageState>;
  taskGraph(context: Context): Promise<AttachedReplicatedState<TaskGraph>>;
  watchTaskGraph(context: Context): Promise<TaskGraphWatch>;
}
