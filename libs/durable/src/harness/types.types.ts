import type { TSchema } from "@msa/ai";
import type { JsonValue } from "@msa/chord";

import type typesModuleSourceTypes from "../types.types.ts";
import type typesCoreTypes from "./types-core.types.ts";
import type typesHooksTypes from "./types-hooks.ts";
import type typesRegistryTypes from "./types-registry.ts";
import type typesToolsTypes from "./types-tools.ts";

declare namespace typesModule {
  type ModelRef = typesCoreTypes.ModelRef;
  type UserInput = typesCoreTypes.UserInput;
  type InputEntry = typesCoreTypes.InputEntry;
  type SubmissionDraft = typesCoreTypes.SubmissionDraft;
  type InputSubmissionDraft = typesCoreTypes.InputSubmissionDraft;
  type SettledSubmissionRecord = typesCoreTypes.SettledSubmissionRecord;
  type Submission = typesCoreTypes.Submission;
  type SettledTask<R> = typesCoreTypes.SettledTask<R>;
  type AnyTask = typesCoreTypes.AnyTask;
  type ConversationAbortOptions = typesCoreTypes.ConversationAbortOptions;
  type HooksOf<K> = typesCoreTypes.HooksOf<K>;
  type ConversationHandle = typesCoreTypes.ConversationHandle;
  type ConversationInit = typesCoreTypes.ConversationInit;
  type ConversationCreateOptions = typesCoreTypes.ConversationCreateOptions;
  type ConversationStreamOptions = typesCoreTypes.ConversationStreamOptions;
  type ConversationRetryPolicy = typesCoreTypes.ConversationRetryPolicy;
  type CompactionPolicy = typesCoreTypes.CompactionPolicy;
  type ProgressPolicy = typesCoreTypes.ProgressPolicy;
  type CompactionReason = typesCoreTypes.CompactionReason;
  type CompactionResult = typesCoreTypes.CompactionResult;
  type HarnessSettings = typesCoreTypes.HarnessSettings;
  type Settings = typesCoreTypes.Settings;
  type EnvTarget = typesCoreTypes.EnvTarget;
  type HarnessOptions<
    Tool extends typesToolsTypes.ToolRegistration = typesToolsTypes.ToolRegistration,
  > = typesCoreTypes.HarnessOptions<Tool>;
  type TaskInspection = typesCoreTypes.TaskInspection;
  type TaskInspectionState = typesCoreTypes.TaskInspectionState;
  type HarnessInspection = typesCoreTypes.HarnessInspection;
  type ContextView = typesCoreTypes.ContextView;
  type Conversation = typesCoreTypes.Conversation;
  type ConversationWatch = typesCoreTypes.ConversationWatch;
  type Harness = typesCoreTypes.Harness;
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
  type Dual2<A, B, R> = typesModuleSourceTypes.Dual2<A, B, R>;
  type Dual3<A, B, C, R> = typesModuleSourceTypes.Dual3<A, B, C, R>;
  type Dual4<A, B, C, D, R> = typesModuleSourceTypes.Dual4<A, B, C, D, R>;
  type Dual5<A, B, C, D, E, R> = typesModuleSourceTypes.Dual5<A, B, C, D, E, R>;
  type JsonObject = typesModuleSourceTypes.JsonObject;
  type Id<Kind extends string, Type = unknown> = typesModuleSourceTypes.Id<Kind, Type>;
  type ConversationId = typesModuleSourceTypes.ConversationId;
  type EntryId = typesModuleSourceTypes.EntryId;
  type TaskId<Result = unknown> = typesModuleSourceTypes.TaskId<Result>;
  type SubmissionId = typesModuleSourceTypes.SubmissionId;
  type DocumentId = typesModuleSourceTypes.DocumentId;
  type Seq = typesModuleSourceTypes.Seq;
  type LatestConversationSemantics = typesModuleSourceTypes.LatestConversationSemantics;
  type RewindableConversationSemantics = typesModuleSourceTypes.RewindableConversationSemantics;
  type DocumentSemantics = typesModuleSourceTypes.DocumentSemantics;
  type CheckpointInfo = typesModuleSourceTypes.CheckpointInfo;
  type CommonDocDefinition<T extends typesModuleSourceTypes.JsonObject> =
    typesModuleSourceTypes.CommonDocDefinition<T>;
  type DocDefinition<T extends typesModuleSourceTypes.JsonObject> =
    typesModuleSourceTypes.DocDefinition<T>;
  type DocFamilyDefinition<
    T extends typesModuleSourceTypes.JsonObject,
    I extends JsonValue,
  > = typesModuleSourceTypes.DocFamilyDefinition<T, I>;
  type DocToken<
    T extends typesModuleSourceTypes.JsonObject,
    D extends DocDefinition<T>,
  > = typesModuleSourceTypes.DocToken<T, D>;
  type DocFamilyToken<
    T extends typesModuleSourceTypes.JsonObject,
    I extends JsonValue,
    D extends DocFamilyDefinition<T, I>,
  > = typesModuleSourceTypes.DocFamilyToken<T, I, D>;
  type SessionDocToken<T extends typesModuleSourceTypes.JsonObject> =
    typesModuleSourceTypes.SessionDocToken<T>;
  type ConversationDocToken<T extends typesModuleSourceTypes.JsonObject> =
    typesModuleSourceTypes.ConversationDocToken<T>;
  type RewindableConversationDocToken<T extends typesModuleSourceTypes.JsonObject> =
    typesModuleSourceTypes.RewindableConversationDocToken<T>;
  type TaskDocToken<T extends typesModuleSourceTypes.JsonObject> =
    typesModuleSourceTypes.TaskDocToken<T>;
  type SessionDocFamilyToken<
    T extends typesModuleSourceTypes.JsonObject,
    I extends JsonValue,
  > = typesModuleSourceTypes.SessionDocFamilyToken<T, I>;
  type ConversationDocFamilyToken<
    T extends typesModuleSourceTypes.JsonObject,
    I extends JsonValue,
  > = typesModuleSourceTypes.ConversationDocFamilyToken<T, I>;
  type RewindableConversationDocFamilyToken<
    T extends typesModuleSourceTypes.JsonObject,
    I extends JsonValue,
  > = typesModuleSourceTypes.RewindableConversationDocFamilyToken<T, I>;
  type TaskDocFamilyToken<
    T extends typesModuleSourceTypes.JsonObject,
    I extends JsonValue,
  > = typesModuleSourceTypes.TaskDocFamilyToken<T, I>;
  type DocumentRecord = typesModuleSourceTypes.DocumentRecord;
  type DocumentCreate = typesModuleSourceTypes.DocumentCreate;
  type DocumentPoint = typesModuleSourceTypes.DocumentPoint;
  type DocumentAddress = typesModuleSourceTypes.DocumentAddress;
  type DocumentQuery = typesModuleSourceTypes.DocumentQuery;
  type DocumentContent = typesModuleSourceTypes.DocumentContent;
  type DocumentCopySource = typesModuleSourceTypes.DocumentCopySource;
  type StoredDocument = typesModuleSourceTypes.StoredDocument;
  type ConversationOwnership = typesModuleSourceTypes.ConversationOwnership;
  type ConversationRecord = typesModuleSourceTypes.ConversationRecord;
  type ContextEdit = typesModuleSourceTypes.ContextEdit;
  type EntryRecord = typesModuleSourceTypes.EntryRecord;
  type EntryDraft = typesModuleSourceTypes.EntryDraft;
  type TypedEntry<D extends JsonValue> = typesModuleSourceTypes.TypedEntry<D>;
  type TypedEntryDraft<D extends JsonValue> = typesModuleSourceTypes.TypedEntryDraft<D>;
  type Entry<D extends JsonValue = never> = typesModuleSourceTypes.Entry<D>;
  type SubmissionRecord = typesModuleSourceTypes.SubmissionRecord;
  type SubmissionSettlement = typesModuleSourceTypes.SubmissionSettlement;
  type SubmissionCreate = typesModuleSourceTypes.SubmissionCreate;
  type RunningTask<I, S, R> = typesModuleSourceTypes.RunningTask<I, S, R>;
  type NextTaskState<S, R> = typesModuleSourceTypes.NextTaskState<S, R>;
  type PhaseHandler<I, P, S, R, H extends object> = typesModuleSourceTypes.PhaseHandler<
    I,
    P,
    S,
    R,
    H
  >;
  type HookRunner<H extends object> = typesModuleSourceTypes.HookRunner<H>;
  type TaskRuntime<I, S, R, H extends object> = typesModuleSourceTypes.TaskRuntime<I, S, R, H>;
  type TaskDefinition<
    I,
    S extends { phase: string },
    R,
    H extends object,
  > = typesModuleSourceTypes.TaskDefinition<I, S, R, H>;
  type Task<I, S extends { phase: string }, R, H extends object> = typesModuleSourceTypes.Task<
    I,
    S,
    R,
    H
  >;
  type TaskOwnership = typesModuleSourceTypes.TaskOwnership;
  type JoinPolicy = typesModuleSourceTypes.JoinPolicy;
  type TaskOptions = typesModuleSourceTypes.TaskOptions;
  type TaskOutcomeError = typesModuleSourceTypes.TaskOutcomeError;
  type TaskOutcome<R> = typesModuleSourceTypes.TaskOutcome<R>;
  type TaskState<S, R> = typesModuleSourceTypes.TaskState<S, R>;
  type TaskRecord<I, S, R> = typesModuleSourceTypes.TaskRecord<I, S, R>;
  type Page<T, C> = typesModuleSourceTypes.Page<T, C>;
  type Cursor = typesModuleSourceTypes.Cursor;
  type ScanOrder = typesModuleSourceTypes.ScanOrder;
  type ConversationQuery = typesModuleSourceTypes.ConversationQuery;
  type EntryQuery = typesModuleSourceTypes.EntryQuery;
  type TaskQuery = typesModuleSourceTypes.TaskQuery;
  type SubmissionQuery = typesModuleSourceTypes.SubmissionQuery;
  type StorageWrite = typesModuleSourceTypes.StorageWrite;
  type DocumentCommitChange = typesModuleSourceTypes.DocumentCommitChange;
  type TableCommitChange = typesModuleSourceTypes.TableCommitChange;
  type CommitChange = typesModuleSourceTypes.CommitChange;
  type CommitPublication = typesModuleSourceTypes.CommitPublication;
  type Storage = typesModuleSourceTypes.Storage;
  type Tx = typesModuleSourceTypes.Tx;
  type DocumentState<T extends typesModuleSourceTypes.JsonObject> =
    typesModuleSourceTypes.DocumentState<T>;
  type WatchEnd = typesModuleSourceTypes.WatchEnd;
  type WatchHandle<T> = typesModuleSourceTypes.WatchHandle<T>;
  type DocumentWatch<T extends typesModuleSourceTypes.JsonObject> =
    typesModuleSourceTypes.DocumentWatch<T>;
  type DocumentReader = typesModuleSourceTypes.DocumentReader;
  type DocumentObserver = typesModuleSourceTypes.DocumentObserver;
  type SessionEnd = typesModuleSourceTypes.SessionEnd;
  type Session = typesModuleSourceTypes.Session;
}

export type { typesModule as default };
