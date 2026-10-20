import type { TSchema } from "@msa/ai";
import type { JsonValue } from "@msa/chord";

import type errorsTypes from "./errors/index.types.ts";
import type harnessApiTypes from "./harness/api.types.ts";
import type harnessPublicTypes from "./harness/public.types.ts";
import type typesModule from "./harness/types.types.ts";
import type memoryTypes from "./storage/memory.types.ts";
import type idsTypes from "./types/ids.types.ts";
import type recordsTypes from "./types/records.ts";

declare namespace durableTypes {
  type CompactionCheckpoint = harnessPublicTypes.CompactionCheckpoint;
  type CompactionInput = harnessPublicTypes.CompactionInput;
  type SummaryRequest = harnessPublicTypes.SummaryRequest;
  type AgentEvent = harnessPublicTypes.AgentEvent;
  type AgentEventStream = harnessPublicTypes.AgentEventStream;
  type MessageChange = harnessPublicTypes.MessageChange;
  type SnapshotEvent = harnessPublicTypes.SnapshotEvent;
  type ToolEventCall = harnessPublicTypes.ToolEventCall;
  type GenerationCheckpoint = harnessPublicTypes.GenerationCheckpoint;
  type GenerationInput = harnessPublicTypes.GenerationInput;
  type GenerationResult = harnessPublicTypes.GenerationResult;
  type InboxItem = harnessPublicTypes.InboxItem;
  type InboxState = harnessPublicTypes.InboxState;
  type CompactionFailure = harnessPublicTypes.CompactionFailure;
  type CompactionStatus = harnessPublicTypes.CompactionStatus;
  type LiveState = harnessPublicTypes.LiveState;
  type NestedToolSlot = harnessPublicTypes.NestedToolSlot;
  type NestedToolSummary = harnessPublicTypes.NestedToolSummary;
  type ToolSlot = harnessPublicTypes.ToolSlot;
  type ProviderState = harnessPublicTypes.ProviderState;
  type TaskGraph = harnessPublicTypes.TaskGraph;
  type TaskGraphNode = harnessPublicTypes.TaskGraphNode;
  type TaskGraphState = harnessPublicTypes.TaskGraphState;
  type TaskGraphWatch = harnessPublicTypes.TaskGraphWatch;
  type NestedCallState = harnessPublicTypes.NestedCallState;
  type ToolTaskCheckpoint = harnessPublicTypes.ToolTaskCheckpoint;
  type ToolTaskInput = harnessPublicTypes.ToolTaskInput;
  type ToolTaskResult = harnessPublicTypes.ToolTaskResult;
  type Agent<Tool extends harnessApiTypes.ToolRegistration = harnessApiTypes.ToolRegistration> =
    harnessApiTypes.Agent<Tool>;
  type AgentChange = typesModule.AgentChange;
  type AgentState = typesModule.AgentState;
  type AnyTask = typesModule.AnyTask;
  type CompactionHooks = typesModule.CompactionHooks;
  type CompactionPolicy = typesModule.CompactionPolicy;
  type CompactionReason = typesModule.CompactionReason;
  type CompactionResult = typesModule.CompactionResult;
  type ContextView = typesModule.ContextView;
  type Conversation = typesModule.Conversation;
  type ConversationAbortOptions = typesModule.ConversationAbortOptions;
  type ConversationCreateOptions = typesModule.ConversationCreateOptions;
  type ConversationHandle = typesModule.ConversationHandle;
  type ConversationInit = typesModule.ConversationInit;
  type ConversationRetryPolicy = typesModule.ConversationRetryPolicy;
  type ConversationStreamOptions = typesModule.ConversationStreamOptions;
  type ConversationWatch = typesModule.ConversationWatch;
  type EnvTarget = typesModule.EnvTarget;
  type Extension<Tool extends harnessApiTypes.ToolRegistration = harnessApiTypes.ToolRegistration> =
    harnessApiTypes.Extension<Tool>;
  type GenerationHooks = typesModule.GenerationHooks;
  type HarnessInspection = typesModule.HarnessInspection;
  type HarnessOptions<
    Tool extends harnessApiTypes.ToolRegistration = harnessApiTypes.ToolRegistration,
  > = typesModule.HarnessOptions<Tool>;
  type HarnessSettings = typesModule.HarnessSettings;
  type HookApi = typesModule.HookApi;
  type HookRegistration = typesModule.HookRegistration;
  type HookResult<T> = typesModule.HookResult<T>;
  type HooksOf<K> = typesModule.HooksOf<K>;
  type InputEntry = typesModule.InputEntry;
  type InputSubmissionDraft = typesModule.InputSubmissionDraft;
  type ModelRef = typesModule.ModelRef;
  type NestedToolExecutionResult = typesModule.NestedToolExecutionResult;
  type ProgressPolicy = typesModule.ProgressPolicy;
  type PromptInput<
    Tool extends harnessApiTypes.ToolRegistration = harnessApiTypes.ToolRegistration,
  > = harnessApiTypes.PromptInput<Tool>;
  type PromptSection<
    Tool extends harnessApiTypes.ToolRegistration = harnessApiTypes.ToolRegistration,
  > = harnessApiTypes.PromptSection<Tool>;
  type QueueMode = typesModule.QueueMode;
  type Registry<Tool extends harnessApiTypes.ToolRegistration = harnessApiTypes.ToolRegistration> =
    harnessApiTypes.Registry<Tool>;
  type RegistryReader<
    Tool extends harnessApiTypes.ToolRegistration = harnessApiTypes.ToolRegistration,
  > = harnessApiTypes.RegistryReader<Tool>;
  type RegistrySnapshot<
    Tool extends harnessApiTypes.ToolRegistration = harnessApiTypes.ToolRegistration,
  > = harnessApiTypes.RegistrySnapshot<Tool>;
  type Settings = typesModule.Settings;
  type SettledSubmissionRecord = typesModule.SettledSubmissionRecord;
  type SettledTask<R> = typesModule.SettledTask<R>;
  type Submission = typesModule.Submission;
  type SubmissionDraft = typesModule.SubmissionDraft;
  type TaskInspection = typesModule.TaskInspection;
  type ToolControl = typesModule.ToolControl;
  type ToolDiagnostic = typesModule.ToolDiagnostic;
  type ToolExecutionApi<TDetails extends JsonValue = JsonValue> =
    harnessApiTypes.ToolExecutionApi<TDetails>;
  type ToolExecutionMode = typesModule.ToolExecutionMode;
  type ToolExecutionResult<TDetails extends JsonValue = JsonValue> =
    harnessApiTypes.ToolExecutionResult<TDetails>;
  type ToolHookCall = typesModule.ToolHookCall;
  type ToolHooks = typesModule.ToolHooks;
  type ToolRegistration<
    TParameters extends TSchema = TSchema,
    TDetails extends JsonValue = JsonValue,
  > = harnessApiTypes.ToolRegistration<TParameters, TDetails>;
  type UserInput = typesModule.UserInput;
  type Wrap<Tool extends harnessApiTypes.ToolRegistration = harnessApiTypes.ToolRegistration> =
    harnessApiTypes.Wrap<Tool>;
  type UsageState = harnessPublicTypes.UsageState;
  type ConversationView = harnessApiTypes.ConversationView;
  type CheckpointInfo = typesModule.CheckpointInfo;
  type CommitChange = typesModule.CommitChange;
  type CommitPublication = typesModule.CommitPublication;
  type CommonDocDefinition<T extends typesModule.JsonObject> = typesModule.CommonDocDefinition<T>;
  type ContextEdit = typesModule.ContextEdit;
  type ConversationDocFamilyToken<
    T extends typesModule.JsonObject,
    I extends JsonValue,
  > = typesModule.ConversationDocFamilyToken<T, I>;
  type ConversationDocToken<T extends typesModule.JsonObject> = typesModule.ConversationDocToken<T>;
  type ConversationId = typesModule.ConversationId;
  type ConversationOwnership = typesModule.ConversationOwnership;
  type ConversationQuery = typesModule.ConversationQuery;
  type ConversationRecord = typesModule.ConversationRecord;
  type Cursor = typesModule.Cursor;
  type DocDefinition<T extends typesModule.JsonObject> = typesModule.DocDefinition<T>;
  type DocFamilyDefinition<
    T extends typesModule.JsonObject,
    I extends JsonValue,
  > = typesModule.DocFamilyDefinition<T, I>;
  type DocFamilyToken<
    T extends typesModule.JsonObject,
    I extends JsonValue,
    D extends DocFamilyDefinition<T, I>,
  > = typesModule.DocFamilyToken<T, I, D>;
  type DocToken<
    T extends typesModule.JsonObject,
    D extends DocDefinition<T>,
  > = typesModule.DocToken<T, D>;
  type DocumentAddress = typesModule.DocumentAddress;
  type DocumentCommitChange = typesModule.DocumentCommitChange;
  type DocumentContent = typesModule.DocumentContent;
  type DocumentCopySource = typesModule.DocumentCopySource;
  type DocumentCreate = typesModule.DocumentCreate;
  type DocumentId = typesModule.DocumentId;
  type DocumentObserver = typesModule.DocumentObserver;
  type DocumentPoint = typesModule.DocumentPoint;
  type DocumentQuery = typesModule.DocumentQuery;
  type DocumentReader = typesModule.DocumentReader;
  type DocumentRecord = typesModule.DocumentRecord;
  type DocumentSemantics = typesModule.DocumentSemantics;
  type DocumentState<T extends typesModule.JsonObject> = typesModule.DocumentState<T>;
  type DocumentWatch<T extends typesModule.JsonObject> = typesModule.DocumentWatch<T>;
  type Entry<D extends JsonValue = never> = recordsTypes.Entry<D>;
  type EntryDraft = typesModule.EntryDraft;
  type EntryId = typesModule.EntryId;
  type EntryQuery = typesModule.EntryQuery;
  type EntryRecord = typesModule.EntryRecord;
  type HookRunner<H extends object> = typesModule.HookRunner<H>;
  type Id<Kind extends string, Type = unknown> = idsTypes.Id<Kind, Type>;
  type JoinPolicy = typesModule.JoinPolicy;
  type JsonObject = typesModule.JsonObject;
  type LatestConversationSemantics = typesModule.LatestConversationSemantics;
  type NextTaskState<S, R> = typesModule.NextTaskState<S, R>;
  type Page<T, C> = typesModule.Page<T, C>;
  type PhaseHandler<I, P, S, R, H extends object> = typesModule.PhaseHandler<I, P, S, R, H>;
  type RewindableConversationDocFamilyToken<
    T extends typesModule.JsonObject,
    I extends JsonValue,
  > = typesModule.RewindableConversationDocFamilyToken<T, I>;
  type RewindableConversationDocToken<T extends typesModule.JsonObject> =
    typesModule.RewindableConversationDocToken<T>;
  type RewindableConversationSemantics = typesModule.RewindableConversationSemantics;
  type RunningTask<I, S, R> = typesModule.RunningTask<I, S, R>;
  type ScanOrder = typesModule.ScanOrder;
  type Seq = typesModule.Seq;
  type Session = typesModule.Session;
  type SessionDocFamilyToken<
    T extends typesModule.JsonObject,
    I extends JsonValue,
  > = typesModule.SessionDocFamilyToken<T, I>;
  type SessionDocToken<T extends typesModule.JsonObject> = typesModule.SessionDocToken<T>;
  type SessionEnd = typesModule.SessionEnd;
  type Storage = typesModule.Storage;
  type StorageWrite = typesModule.StorageWrite;
  type StoredDocument = typesModule.StoredDocument;
  type SubmissionCreate = typesModule.SubmissionCreate;
  type SubmissionId = typesModule.SubmissionId;
  type SubmissionQuery = typesModule.SubmissionQuery;
  type SubmissionRecord = typesModule.SubmissionRecord;
  type SubmissionSettlement = typesModule.SubmissionSettlement;
  type TableCommitChange = typesModule.TableCommitChange;
  type Task<I, S extends { phase: string }, R, H extends object> = typesModule.Task<I, S, R, H>;
  type TaskDefinition<
    I,
    S extends { phase: string },
    R,
    H extends object,
  > = typesModule.TaskDefinition<I, S, R, H>;
  type TaskDocFamilyToken<
    T extends typesModule.JsonObject,
    I extends JsonValue,
  > = typesModule.TaskDocFamilyToken<T, I>;
  type TaskDocToken<T extends typesModule.JsonObject> = typesModule.TaskDocToken<T>;
  type TaskId<Result = unknown> = idsTypes.TaskId<Result>;
  type TaskOptions = typesModule.TaskOptions;
  type TaskOutcome<R> = typesModule.TaskOutcome<R>;
  type TaskOutcomeError = typesModule.TaskOutcomeError;
  type TaskOwnership = typesModule.TaskOwnership;
  type TaskQuery = typesModule.TaskQuery;
  type TaskRecord<I, S, R> = typesModule.TaskRecord<I, S, R>;
  type TaskRuntime<I, S, R, H extends object> = typesModule.TaskRuntime<I, S, R, H>;
  type TaskState<S, R> = typesModule.TaskState<S, R>;
  type Tx = typesModule.Tx;
  type TypedEntry<D extends JsonValue> = typesModule.TypedEntry<D>;
  type TypedEntryDraft<D extends JsonValue> = typesModule.TypedEntryDraft<D>;
  type WatchEnd = typesModule.WatchEnd;
  type WatchHandle<T> = typesModule.WatchHandle<T>;
  type Harness = harnessPublicTypes.Harness;
  type ConversationBusy = errorsTypes.ConversationBusy;
  type ReadAfterWrite = errorsTypes.ReadAfterWrite;
  type SessionFailed = errorsTypes.SessionFailed;
  type StorageRequestError = errorsTypes.StorageRequestError;
  type MemoryStorage = memoryTypes.MemoryStorage;
}

export type { durableTypes as default };
