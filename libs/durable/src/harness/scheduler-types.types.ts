import type { TSchema } from "@msa/ai";
import type { JsonValue } from "@msa/chord";

import type transactionTypes from "../session/transaction.types.ts";
import type typesSourceTypes from "../types.types.ts";
import type schedulerCoreTypes from "./scheduler-core.types.ts";
import type typesHooksTypes from "./types-hooks.ts";
import type typesRegistryTypes from "./types-registry.ts";
import type typesToolsTypes from "./types-tools.ts";
import type typesModule from "./types.types.ts";

declare namespace schedulerTypesModule {
  type AnyTaskRecord = schedulerCoreTypes.AnyTaskRecord;
  type RunnableTaskRecord = schedulerCoreTypes.RunnableTaskRecord;
  type Checkpoint = schedulerCoreTypes.Checkpoint;
  type ErasedDefinition = schedulerCoreTypes.ErasedDefinition;
  type ErasedRuntime = schedulerCoreTypes.ErasedRuntime;
  type ErasedRunningTask = schedulerCoreTypes.ErasedRunningTask;
  type BlockedReason = schedulerCoreTypes.BlockedReason;
  type Resolution = schedulerCoreTypes.Resolution;
  type Fit = schedulerCoreTypes.Fit;
  type Invocation = schedulerCoreTypes.Invocation;
  type Phase = schedulerCoreTypes.Phase;
  type Reservation = schedulerCoreTypes.Reservation;
  type ReportedTask = schedulerCoreTypes.ReportedTask;
  type PhaseResult = schedulerCoreTypes.PhaseResult;
  type Decision = schedulerCoreTypes.Decision;
  type SchedulerOutcome = schedulerCoreTypes.SchedulerOutcome;
  type InvocationBinding = schedulerCoreTypes.InvocationBinding;
  type TaskNode = schedulerCoreTypes.TaskNode;
  type Up = schedulerCoreTypes.Up;
  type Step = schedulerCoreTypes.Step;
  type Node = schedulerCoreTypes.Node;
  type Overlay = schedulerCoreTypes.Overlay;
  type Scope = schedulerCoreTypes.Scope;
  type WalkOptions = schedulerCoreTypes.WalkOptions;
  type Walked = schedulerCoreTypes.Walked;
  type TaskSchedulerOptions = schedulerCoreTypes.TaskSchedulerOptions;
  type ModelRef = typesModule.ModelRef;
  type UserInput = typesModule.UserInput;
  type InputEntry = typesModule.InputEntry;
  type SubmissionDraft = typesModule.SubmissionDraft;
  type InputSubmissionDraft = typesModule.InputSubmissionDraft;
  type SettledSubmissionRecord = typesModule.SettledSubmissionRecord;
  type Submission = typesModule.Submission;
  type SettledTask<R> = typesModule.SettledTask<R>;
  type AnyTask = typesModule.AnyTask;
  type ConversationAbortOptions = typesModule.ConversationAbortOptions;
  type HooksOf<K> = typesModule.HooksOf<K>;
  type ConversationHandle = typesModule.ConversationHandle;
  type ConversationInit = typesModule.ConversationInit;
  type ConversationCreateOptions = typesModule.ConversationCreateOptions;
  type ConversationStreamOptions = typesModule.ConversationStreamOptions;
  type ConversationRetryPolicy = typesModule.ConversationRetryPolicy;
  type CompactionPolicy = typesModule.CompactionPolicy;
  type ProgressPolicy = typesModule.ProgressPolicy;
  type CompactionReason = typesModule.CompactionReason;
  type CompactionResult = typesModule.CompactionResult;
  type HarnessSettings = typesModule.HarnessSettings;
  type Settings = typesModule.Settings;
  type EnvTarget = typesModule.EnvTarget;
  type HarnessOptions<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = typesModule.HarnessOptions<Tool>;
  type TaskInspection = typesModule.TaskInspection;
  type HarnessInspection = typesModule.HarnessInspection;
  type ContextView = typesModule.ContextView;
  type Conversation = typesModule.Conversation;
  type ConversationWatch = typesModule.ConversationWatch;
  type Harness = typesModule.Harness;
  type ToolControl = typesToolsTypes.ToolControl;
  type ToolDiagnostic = typesToolsTypes.ToolDiagnostic;
  type ToolExecutionResult<TDetails extends JsonValue = JsonValue> =
    typesToolsTypes.ToolExecutionResult<TDetails>;
  type NestedToolExecutionResult = typesToolsTypes.NestedToolExecutionResult;
  type ToolExecutionMode = typesToolsTypes.ToolExecutionMode;
  type QueueMode = typesToolsTypes.QueueMode;
  type ToolExecutionApi<TDetails extends JsonValue = JsonValue> =
    typesToolsTypes.ToolExecutionApi<TDetails>;
  type ToolRegistration<
    TParameters extends TSchema = TSchema,
    TDetails extends JsonValue = JsonValue,
  > = typesToolsTypes.ToolRegistration<TParameters, TDetails>;
  type PromptInput<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = typesRegistryTypes.PromptInput<Tool>;
  type PromptSection<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = typesRegistryTypes.PromptSection<Tool>;
  type HookRegistration = typesRegistryTypes.HookRegistration;
  type Wrap<Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration> =
    typesRegistryTypes.Wrap<Tool>;
  type Extension<Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration> =
    typesRegistryTypes.Extension<Tool>;
  type RegistrySnapshot<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = typesRegistryTypes.RegistrySnapshot<Tool>;
  type RegistryReader<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = typesRegistryTypes.RegistryReader<Tool>;
  type Registry<Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration> =
    typesRegistryTypes.Registry<Tool>;
  type AgentState = typesRegistryTypes.AgentState;
  type AgentChange = typesRegistryTypes.AgentChange;
  type Agent<Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration> =
    typesRegistryTypes.Agent<Tool>;
  type HookApi = typesHooksTypes.HookApi;
  type HookResult<T> = typesHooksTypes.HookResult<T>;
  type GenerationHooks = typesHooksTypes.GenerationHooks;
  type ToolHookCall = typesHooksTypes.ToolHookCall;
  type ToolHooks = typesHooksTypes.ToolHooks;
  type CompactionHooks = typesHooksTypes.CompactionHooks;
  type Dual2<A, B, R> = typesSourceTypes.Dual2<A, B, R>;
  type Dual3<A, B, C, R> = typesSourceTypes.Dual3<A, B, C, R>;
  type Dual4<A, B, C, D, R> = typesSourceTypes.Dual4<A, B, C, D, R>;
  type Dual5<A, B, C, D, E, R> = typesSourceTypes.Dual5<A, B, C, D, E, R>;
  type JsonObject = typesSourceTypes.JsonObject;
  type Id<Kind extends string, Type = unknown> = typesSourceTypes.Id<Kind, Type>;
  type ConversationId = typesSourceTypes.ConversationId;
  type EntryId = typesSourceTypes.EntryId;
  type TaskId<Result = unknown> = typesSourceTypes.TaskId<Result>;
  type SubmissionId = typesSourceTypes.SubmissionId;
  type DocumentId = typesSourceTypes.DocumentId;
  type Seq = typesSourceTypes.Seq;
  type LatestConversationSemantics = typesSourceTypes.LatestConversationSemantics;
  type RewindableConversationSemantics = typesSourceTypes.RewindableConversationSemantics;
  type DocumentSemantics = typesSourceTypes.DocumentSemantics;
  type CheckpointInfo = typesSourceTypes.CheckpointInfo;
  type CommonDocDefinition<T extends typesSourceTypes.JsonObject> =
    typesSourceTypes.CommonDocDefinition<T>;
  type DocDefinition<T extends typesSourceTypes.JsonObject> = typesSourceTypes.DocDefinition<T>;
  type DocFamilyDefinition<
    T extends typesSourceTypes.JsonObject,
    I extends JsonValue,
  > = typesSourceTypes.DocFamilyDefinition<T, I>;
  type DocToken<
    T extends typesSourceTypes.JsonObject,
    D extends DocDefinition<T>,
  > = typesSourceTypes.DocToken<T, D>;
  type DocFamilyToken<
    T extends typesSourceTypes.JsonObject,
    I extends JsonValue,
    D extends DocFamilyDefinition<T, I>,
  > = typesSourceTypes.DocFamilyToken<T, I, D>;
  type SessionDocToken<T extends typesSourceTypes.JsonObject> = typesSourceTypes.SessionDocToken<T>;
  type ConversationDocToken<T extends typesSourceTypes.JsonObject> =
    typesSourceTypes.ConversationDocToken<T>;
  type RewindableConversationDocToken<T extends typesSourceTypes.JsonObject> =
    typesSourceTypes.RewindableConversationDocToken<T>;
  type TaskDocToken<T extends typesSourceTypes.JsonObject> = typesSourceTypes.TaskDocToken<T>;
  type SessionDocFamilyToken<
    T extends typesSourceTypes.JsonObject,
    I extends JsonValue,
  > = typesSourceTypes.SessionDocFamilyToken<T, I>;
  type ConversationDocFamilyToken<
    T extends typesSourceTypes.JsonObject,
    I extends JsonValue,
  > = typesSourceTypes.ConversationDocFamilyToken<T, I>;
  type RewindableConversationDocFamilyToken<
    T extends typesSourceTypes.JsonObject,
    I extends JsonValue,
  > = typesSourceTypes.RewindableConversationDocFamilyToken<T, I>;
  type TaskDocFamilyToken<
    T extends typesSourceTypes.JsonObject,
    I extends JsonValue,
  > = typesSourceTypes.TaskDocFamilyToken<T, I>;
  type DocumentRecord = typesSourceTypes.DocumentRecord;
  type DocumentCreate = typesSourceTypes.DocumentCreate;
  type DocumentPoint = typesSourceTypes.DocumentPoint;
  type DocumentAddress = typesSourceTypes.DocumentAddress;
  type DocumentQuery = typesSourceTypes.DocumentQuery;
  type DocumentContent = typesSourceTypes.DocumentContent;
  type DocumentCopySource = typesSourceTypes.DocumentCopySource;
  type StoredDocument = typesSourceTypes.StoredDocument;
  type ConversationOwnership = typesSourceTypes.ConversationOwnership;
  type ConversationRecord = typesSourceTypes.ConversationRecord;
  type ContextEdit = typesSourceTypes.ContextEdit;
  type EntryRecord = typesSourceTypes.EntryRecord;
  type EntryDraft = typesSourceTypes.EntryDraft;
  type TypedEntry<D extends JsonValue> = typesSourceTypes.TypedEntry<D>;
  type TypedEntryDraft<D extends JsonValue> = typesSourceTypes.TypedEntryDraft<D>;
  type Entry<D extends JsonValue = never> = typesSourceTypes.Entry<D>;
  type SubmissionRecord = typesSourceTypes.SubmissionRecord;
  type SubmissionSettlement = typesSourceTypes.SubmissionSettlement;
  type SubmissionCreate = typesSourceTypes.SubmissionCreate;
  type RunningTask<I, S, R> = typesSourceTypes.RunningTask<I, S, R>;
  type NextTaskState<S, R> = typesSourceTypes.NextTaskState<S, R>;
  type PhaseHandler<I, P, S, R, H extends object> = typesSourceTypes.PhaseHandler<I, P, S, R, H>;
  type HookRunner<H extends object> = typesSourceTypes.HookRunner<H>;
  type TaskRuntime<I, S, R, H extends object> = typesSourceTypes.TaskRuntime<I, S, R, H>;
  type TaskDefinition<
    I,
    S extends { phase: string },
    R,
    H extends object,
  > = typesSourceTypes.TaskDefinition<I, S, R, H>;
  type Task<I, S extends { phase: string }, R, H extends object> = typesSourceTypes.Task<
    I,
    S,
    R,
    H
  >;
  type TaskOwnership = typesSourceTypes.TaskOwnership;
  type JoinPolicy = typesSourceTypes.JoinPolicy;
  type TaskOptions = typesSourceTypes.TaskOptions;
  type TaskOutcomeError = typesSourceTypes.TaskOutcomeError;
  type TaskOutcome<R> = typesSourceTypes.TaskOutcome<R>;
  type TaskState<S, R> = typesSourceTypes.TaskState<S, R>;
  type TaskRecord<I, S, R> = typesSourceTypes.TaskRecord<I, S, R>;
  type Page<T, C> = typesSourceTypes.Page<T, C>;
  type Cursor = typesSourceTypes.Cursor;
  type ScanOrder = typesSourceTypes.ScanOrder;
  type ConversationQuery = typesSourceTypes.ConversationQuery;
  type EntryQuery = typesSourceTypes.EntryQuery;
  type TaskQuery = typesSourceTypes.TaskQuery;
  type SubmissionQuery = typesSourceTypes.SubmissionQuery;
  type StorageWrite = typesSourceTypes.StorageWrite;
  type DocumentCommitChange = typesSourceTypes.DocumentCommitChange;
  type TableCommitChange = typesSourceTypes.TableCommitChange;
  type CommitChange = typesSourceTypes.CommitChange;
  type CommitPublication = typesSourceTypes.CommitPublication;
  type Storage = typesSourceTypes.Storage;
  type Tx = typesSourceTypes.Tx;
  type DocumentState<T extends typesSourceTypes.JsonObject> = typesSourceTypes.DocumentState<T>;
  type WatchEnd = typesSourceTypes.WatchEnd;
  type WatchHandle<T> = typesSourceTypes.WatchHandle<T>;
  type DocumentWatch<T extends typesSourceTypes.JsonObject> = typesSourceTypes.DocumentWatch<T>;
  type DocumentReader = typesSourceTypes.DocumentReader;
  type DocumentObserver = typesSourceTypes.DocumentObserver;
  type SessionEnd = typesSourceTypes.SessionEnd;
  type Session = typesSourceTypes.Session;
  type Transaction = transactionTypes.Transaction;
}

export type { schedulerTypesModule as default };
