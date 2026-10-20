import type { CacheRetention, Message, Models, Transport, UserMessage } from "@msa/ai";
import type { AttachedReplicatedState, Context, JsonValue } from "@msa/chord";

import type envTypes from "../env/index.types.ts";
import type typesModuleSourceTypes from "../types.types.ts";
import type taskGraphTypes from "./task-graph.types.ts";
import type typesRegistryTypes from "./types-registry.ts";
import type typesToolsTypes from "./types-tools.ts";
import type usageTypes from "./usage.types.ts";
import type viewTypes from "./view.types.ts";

declare namespace typesCoreTypes {
  type ModelRef = {
    readonly provider: string;
    readonly modelId: string;
  };
  type UserInput = UserMessage["content"];
  type InputEntry = { readonly kind: string; readonly data?: JsonValue };
  type SubmissionDraft = {
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
        readonly entry: typesModuleSourceTypes.EntryDraft;
        readonly content?: never;
        readonly whenBusy?: never;
      }
  );
  type InputSubmissionDraft = Extract<SubmissionDraft, { readonly type: "input" }>;
  type SettledSubmissionRecord = typesModuleSourceTypes.SubmissionRecord & {
    readonly status: "done" | "unanswered";
  };
  interface Submission {
    readonly id: typesModuleSourceTypes.SubmissionId;
    status(context: Context): Promise<typesModuleSourceTypes.SubmissionRecord>;
    wait(context: Context): Promise<SettledSubmissionRecord>;
    abort(context: Context): Promise<"aborted" | "already_placed" | "settled">;
  }
  type SettledTask<R> = typesModuleSourceTypes.TaskRecord<JsonValue, JsonValue, R> & {
    readonly state: Extract<
      typesModuleSourceTypes.TaskState<JsonValue, R>,
      { readonly status: "terminal" }
    >;
  };
  type AnyTask = {
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
  type ConversationAbortOptions = {
    readonly background?: boolean;
  };
  type HooksOf<K> =
    K extends typesModuleSourceTypes.Task<infer _I, infer _S, infer _R, infer H> ? H : never;
  interface ConversationHandle {
    readonly id: typesModuleSourceTypes.ConversationId;
    submit(submission: InputSubmissionDraft, context: Context): Promise<Submission>;
    abort(context: Context, options?: ConversationAbortOptions): Promise<void>;
    waitForIdle(context: Context): Promise<void>;
  }
  type ConversationInit = (
    tx: typesModuleSourceTypes.Tx,
    conversationId: typesModuleSourceTypes.ConversationId,
  ) => void | Promise<void>;
  type ConversationCreateOptions = {
    readonly ownership: typesModuleSourceTypes.ConversationOwnership;
    readonly agent?: typesRegistryTypes.AgentChange;
    readonly init?: ConversationInit;
  };
  type ConversationStreamOptions = {
    transport?: Transport;
    timeoutMs?: number;
    maxRetries?: number;
    maxRetryDelayMs?: number;
    headers?: Record<string, string>;
    metadata?: typesModuleSourceTypes.JsonObject;
    cacheRetention?: CacheRetention;
    deferred?: boolean | { window?: "15m" | "1h" | "24h" };
  };
  type ConversationRetryPolicy = {
    enabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxAgentDelayMs?: number;
  };
  type CompactionPolicy = {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
    backgroundTokens: number;
  };
  type ProgressPolicy = {
    partialIntervalMs: number;
    outputIntervalMs: number;
  };
  type CompactionReason = "manual" | "threshold" | "overflow";
  type CompactionResult = {
    entryId?: typesModuleSourceTypes.EntryId;
    submissionId?: typesModuleSourceTypes.SubmissionId;
  };
  type HarnessSettings = {
    readonly extensions?: readonly typesRegistryTypes.Extension[] | undefined;
    readonly stream?: ConversationStreamOptions;
    readonly retry?: Partial<ConversationRetryPolicy>;
    readonly compaction?: Partial<CompactionPolicy>;
    readonly progress?: { readonly [K in keyof ProgressPolicy]?: ProgressPolicy[K] | undefined };
    readonly toolExecution?: typesToolsTypes.ToolExecutionMode;
    readonly steeringMode?: typesToolsTypes.QueueMode;
    readonly followUpMode?: typesToolsTypes.QueueMode;
    readonly contextRetentionMs?: number;
    readonly documentRetentionMs?: number;
  };
  type Settings = {
    readonly extensions?: readonly typesRegistryTypes.Extension[];
    readonly stream: ConversationStreamOptions;
    readonly retry: ConversationRetryPolicy;
    readonly compaction: CompactionPolicy;
    readonly progress: ProgressPolicy;
    readonly toolExecution: typesToolsTypes.ToolExecutionMode;
    readonly steeringMode: typesToolsTypes.QueueMode;
    readonly followUpMode: typesToolsTypes.QueueMode;
    readonly contextRetentionMs: number;
    readonly documentRetentionMs: number;
  };
  type EnvTarget = {
    readonly conversationId: typesModuleSourceTypes.ConversationId;
    readonly cwd?: string;
    readonly read: typesModuleSourceTypes.DocumentReader;
  };
  type HarnessOptions<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = {
    readonly models: Models;
    readonly registry: typesRegistryTypes.RegistryReader<Tool>;
    readonly settings?: HarnessSettings;
    readonly env?: (
      target: EnvTarget,
      context: Context,
    ) => envTypes.ExecutionEnv | undefined | Promise<envTypes.ExecutionEnv | undefined>;
    readonly conversationCreated?: (
      tx: typesModuleSourceTypes.Tx,
      conversation: typesModuleSourceTypes.ConversationRecord,
    ) => void | Promise<void>;
    readonly now?: () => number;
    readonly onReport?: (error: unknown) => void;
  };
  type TaskInspection = {
    readonly record: typesModuleSourceTypes.TaskRecord<JsonValue, JsonValue, JsonValue>;
    readonly state: TaskInspectionState;
  };
  type TaskInspectionState =
    | { readonly kind: "running" }
    | { readonly kind: "ready"; readonly migrates: boolean }
    | { readonly kind: "waiting"; readonly on: readonly typesModuleSourceTypes.TaskId[] }
    | { readonly kind: "completing" }
    | {
        readonly kind: "blocked";
        readonly reason: "missing_task" | "task_too_old" | "migration_failed";
        readonly error?: unknown;
      };
  type HarnessInspection = {
    readonly scheduling: "paused" | "running" | "closing";
    readonly tasks: readonly TaskInspection[];
    readonly submissions: readonly typesModuleSourceTypes.SubmissionRecord[];
  };
  type ContextView = {
    readonly head: typesModuleSourceTypes.EntryRecord | undefined;
    readonly entries: readonly typesModuleSourceTypes.EntryRecord[];
    readonly contributions: readonly (readonly Message[])[];
    readonly messages: readonly Message[];
  };
  interface Conversation {
    readonly id: typesModuleSourceTypes.ConversationId;

    agent(context: Context): Promise<typesRegistryTypes.Agent>;
    configure(change: typesRegistryTypes.AgentChange, context: Context): Promise<void>;

    submit(submission: SubmissionDraft, context: Context): Promise<Submission>;
    reset(handoff: string | undefined, context: Context): Promise<void>;
    compact(
      instructions: string | undefined,
      context: Context,
    ): Promise<typesModuleSourceTypes.TaskId<CompactionResult>>;

    commit<T>(
      change: (tx: typesModuleSourceTypes.Tx) => T | Promise<T>,
      context: Context,
    ): Promise<T>;
    context(
      context: Context,
      options?: { readonly at?: typesModuleSourceTypes.EntryId },
    ): Promise<ContextView>;
    entries(
      query: Omit<typesModuleSourceTypes.EntryQuery, "conversationId">,
      limit: number,
      cursor: typesModuleSourceTypes.Cursor | undefined,
      context: Context,
    ): Promise<
      typesModuleSourceTypes.Page<typesModuleSourceTypes.EntryRecord, typesModuleSourceTypes.Cursor>
    >;
    fork(
      at: typesModuleSourceTypes.EntryId,
      options: ConversationCreateOptions,
      context: Context,
    ): Promise<Conversation>;
    abort(context: Context, options?: ConversationAbortOptions): Promise<void>;
    waitForIdle(context: Context): Promise<void>;
    viewState(context: Context): Promise<AttachedReplicatedState<viewTypes.ConversationView>>;
    watch(context: Context): Promise<ConversationWatch>;
  }
  type ConversationWatch = typesModuleSourceTypes.WatchHandle<viewTypes.ConversationView>;
  interface Harness extends typesModuleSourceTypes.Session {
    resume(): void;

    root(
      context: Context,
      options?: {
        readonly agent?: typesRegistryTypes.AgentChange;
        readonly init?: ConversationInit;
      },
    ): Promise<Conversation>;
    conversation(
      id: typesModuleSourceTypes.ConversationId,
      context: Context,
    ): Promise<Conversation | undefined>;
    createConversation(options: ConversationCreateOptions, context: Context): Promise<Conversation>;

    getTask<R>(
      id: typesModuleSourceTypes.TaskId<R>,
      context: Context,
    ): Promise<typesModuleSourceTypes.TaskRecord<JsonValue, JsonValue, R> | undefined>;
    inspect(context: Context): Promise<HarnessInspection>;
    submission(
      id: typesModuleSourceTypes.SubmissionId,
      context: Context,
    ): Promise<Submission | undefined>;
    abortSubmission(
      id: typesModuleSourceTypes.SubmissionId,
      context: Context,
      conversationId?: typesModuleSourceTypes.ConversationId,
    ): Promise<"aborted" | "already_placed" | "settled" | "not_found">;
    abortTask(id: typesModuleSourceTypes.TaskId, context: Context): Promise<"marked" | "terminal">;
    waitForTask<R>(id: typesModuleSourceTypes.TaskId<R>, context: Context): Promise<SettledTask<R>>;
    waitForIdle(context: Context): Promise<void>;
    usage(context: Context): Promise<usageTypes.UsageState>;
    taskGraph(context: Context): Promise<AttachedReplicatedState<taskGraphTypes.TaskGraph>>;
    watchTaskGraph(context: Context): Promise<taskGraphTypes.TaskGraphWatch>;
  }
}

export type { typesCoreTypes as default };
