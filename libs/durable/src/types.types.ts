import type chordTypes from "@msa/chord/index.types";

import type dualTypes from "./dual.ts";
import type documentsTypes from "./types/documents.types.ts";
import type idsTypes from "./types/ids.types.ts";
import type recordsTypes from "./types/records.ts";
import type sessionTypes from "./types/session.ts";
import type storageTypes from "./types/storage.ts";
import type tasksTypes from "./types/tasks.ts";

declare namespace typesModule {
  type Dual2<A, B, R> = dualTypes.Dual2<A, B, R>;

  type Dual3<A, B, C, R> = dualTypes.Dual3<A, B, C, R>;

  type Dual4<A, B, C, D, R> = dualTypes.Dual4<A, B, C, D, R>;

  type Dual5<A, B, C, D, E, R> = dualTypes.Dual5<A, B, C, D, E, R>;

  type JsonObject = idsTypes.JsonObject;

  type Id<Kind extends string, Type = unknown> = idsTypes.Id<Kind, Type>;

  type ConversationId = idsTypes.ConversationId;

  type EntryId = idsTypes.EntryId;

  type TaskId<Result = unknown> = idsTypes.TaskId<Result>;

  type SubmissionId = idsTypes.SubmissionId;

  type DocumentId = idsTypes.DocumentId;

  type Seq = idsTypes.Seq;

  type LatestConversationSemantics = documentsTypes.LatestConversationSemantics;

  type RewindableConversationSemantics = documentsTypes.RewindableConversationSemantics;

  type DocumentSemantics = documentsTypes.DocumentSemantics;

  type CheckpointInfo = documentsTypes.CheckpointInfo;

  type CommonDocDefinition<T extends idsTypes.JsonObject> = documentsTypes.CommonDocDefinition<T>;

  type DocDefinition<T extends idsTypes.JsonObject> = documentsTypes.DocDefinition<T>;

  type DocFamilyDefinition<
    T extends idsTypes.JsonObject,
    I extends chordTypes.JsonValue,
  > = documentsTypes.DocFamilyDefinition<T, I>;

  type DocToken<
    T extends idsTypes.JsonObject,
    D extends DocDefinition<T>,
  > = documentsTypes.DocToken<T, D>;

  type DocFamilyToken<
    T extends idsTypes.JsonObject,
    I extends chordTypes.JsonValue,
    D extends DocFamilyDefinition<T, I>,
  > = documentsTypes.DocFamilyToken<T, I, D>;

  type SessionDocToken<T extends idsTypes.JsonObject> = documentsTypes.SessionDocToken<T>;

  type ConversationDocToken<T extends idsTypes.JsonObject> = documentsTypes.ConversationDocToken<T>;

  type RewindableConversationDocToken<T extends idsTypes.JsonObject> =
    documentsTypes.RewindableConversationDocToken<T>;

  type TaskDocToken<T extends idsTypes.JsonObject> = documentsTypes.TaskDocToken<T>;

  type SessionDocFamilyToken<
    T extends idsTypes.JsonObject,
    I extends chordTypes.JsonValue,
  > = documentsTypes.SessionDocFamilyToken<T, I>;

  type ConversationDocFamilyToken<
    T extends idsTypes.JsonObject,
    I extends chordTypes.JsonValue,
  > = documentsTypes.ConversationDocFamilyToken<T, I>;

  type RewindableConversationDocFamilyToken<
    T extends idsTypes.JsonObject,
    I extends chordTypes.JsonValue,
  > = documentsTypes.RewindableConversationDocFamilyToken<T, I>;

  type TaskDocFamilyToken<
    T extends idsTypes.JsonObject,
    I extends chordTypes.JsonValue,
  > = documentsTypes.TaskDocFamilyToken<T, I>;

  type DocumentRecord = documentsTypes.DocumentRecord;

  type DocumentCreate = documentsTypes.DocumentCreate;

  type DocumentPoint = documentsTypes.DocumentPoint;

  type DocumentAddress = documentsTypes.DocumentAddress;

  type DocumentQuery = documentsTypes.DocumentQuery;

  type DocumentContent = documentsTypes.DocumentContent;

  type DocumentCopySource = documentsTypes.DocumentCopySource;

  type StoredDocument = documentsTypes.StoredDocument;

  type ConversationOwnership = recordsTypes.ConversationOwnership;

  type ConversationRecord = recordsTypes.ConversationRecord;

  type ContextEdit = recordsTypes.ContextEdit;

  type EntryRecord = recordsTypes.EntryRecord;

  type EntryDraft = recordsTypes.EntryDraft;

  type TypedEntry<D extends chordTypes.JsonValue> = recordsTypes.TypedEntry<D>;

  type TypedEntryDraft<D extends chordTypes.JsonValue> = recordsTypes.TypedEntryDraft<D>;

  type Entry<D extends chordTypes.JsonValue = never> = recordsTypes.Entry<D>;

  type SubmissionRecord = recordsTypes.SubmissionRecord;

  type SubmissionSettlement = recordsTypes.SubmissionSettlement;

  type SubmissionCreate = recordsTypes.SubmissionCreate;

  type RunningTask<I, S, R> = tasksTypes.RunningTask<I, S, R>;

  type NextTaskState<S, R> = tasksTypes.NextTaskState<S, R>;

  type PhaseHandler<I, P, S, R, H extends object> = tasksTypes.PhaseHandler<I, P, S, R, H>;

  type HookRunner<H extends object> = tasksTypes.HookRunner<H>;

  type TaskRuntime<I, S, R, H extends object> = tasksTypes.TaskRuntime<I, S, R, H>;

  type TaskDefinition<
    I,
    S extends { phase: string },
    R,
    H extends object,
  > = tasksTypes.TaskDefinition<I, S, R, H>;

  type Task<I, S extends { phase: string }, R, H extends object> = tasksTypes.Task<I, S, R, H>;

  type TaskOwnership = tasksTypes.TaskOwnership;

  type JoinPolicy = tasksTypes.JoinPolicy;

  type TaskOptions = tasksTypes.TaskOptions;

  type TaskOutcomeError = tasksTypes.TaskOutcomeError;

  type TaskOutcome<R> = tasksTypes.TaskOutcome<R>;

  type TaskState<S, R> = tasksTypes.TaskState<S, R>;

  type TaskRecord<I, S, R> = tasksTypes.TaskRecord<I, S, R>;

  type Page<T, C> = storageTypes.Page<T, C>;

  type Cursor = storageTypes.Cursor;

  type ScanOrder = storageTypes.ScanOrder;

  type ConversationQuery = storageTypes.ConversationQuery;

  type EntryQuery = storageTypes.EntryQuery;

  type TaskQuery = storageTypes.TaskQuery;

  type SubmissionQuery = storageTypes.SubmissionQuery;

  type StorageWrite = storageTypes.StorageWrite;

  type DocumentCommitChange = storageTypes.DocumentCommitChange;

  type TableCommitChange = storageTypes.TableCommitChange;

  type CommitChange = storageTypes.CommitChange;

  type CommitPublication = storageTypes.CommitPublication;

  type Storage = storageTypes.Storage;

  type Tx = sessionTypes.Tx;

  type DocumentState<T extends idsTypes.JsonObject> = sessionTypes.DocumentState<T>;

  type WatchEnd = sessionTypes.WatchEnd;

  type WatchHandle<T> = sessionTypes.WatchHandle<T>;

  type DocumentWatch<T extends idsTypes.JsonObject> = sessionTypes.DocumentWatch<T>;

  type DocumentReader = sessionTypes.DocumentReader;

  type DocumentObserver = sessionTypes.DocumentObserver;

  type SessionEnd = sessionTypes.SessionEnd;

  type Session = sessionTypes.Session;
}

export type { typesModule as default };
