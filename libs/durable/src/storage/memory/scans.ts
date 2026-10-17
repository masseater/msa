import { Function } from "effect";

import type {
  ConversationQuery,
  ConversationRecord,
  Cursor,
  DocumentQuery,
  DocumentRecord,
  EntryQuery,
  EntryRecord,
  Id,
  Page,
  SubmissionQuery,
  SubmissionRecord,
  TaskQuery,
} from "../../types.ts";
import { scanStart } from "../scan.ts";
import { visibleEntries, visibleEntriesAscending } from "./entries.ts";
import {
  cursorId,
  isAliveAt,
  page,
  scanIndexes,
  scopeKey,
  type State,
  type StoredTask,
  upperBound,
} from "./state.ts";

type Scan<Q, T> = {
  (query: Q, limit: number, cursor: Cursor | undefined): (state: State) => Page<T, Cursor>;
  (state: State, query: Q, limit: number, cursor: Cursor | undefined): Page<T, Cursor>;
};

const collect = <I extends Id<string>, T>(
  ids: readonly I[],
  indexes: Iterable<number>,
  limit: number,
  pick: (id: I) => T | undefined,
): T[] => {
  const values: T[] = [];
  for (const index of indexes) {
    if (values.length > limit) break;
    const value = pick(ids[index]!);
    if (value !== undefined) values.push(value);
  }
  return values;
};

export const scanConversationIds: Scan<ConversationQuery, ConversationRecord> = Function.dual(
  4,
  (
    state: State,
    query: ConversationQuery,
    limit: number,
    cursor: Cursor | undefined,
  ): Page<ConversationRecord, Cursor> => {
    const ids =
      query.ownerTaskId === undefined
        ? query.ownerConversationId === undefined
          ? state.conversationIds
          : (state.conversationIdsByOwnerConversation.get(query.ownerConversationId) ?? [])
        : (state.conversationIdsByOwnerTask.get(query.ownerTaskId) ?? []);
    const start = scanStart(query.order, cursor, "ascending");
    const values = collect(ids, scanIndexes(ids, start), limit, (id) => {
      const value = state.conversations.get(id)!;
      return query.ownerConversationId !== undefined &&
        value.owner?.conversationId !== query.ownerConversationId
        ? undefined
        : value;
    });
    return page(values, limit, start.order);
  },
);

export const scanEntryRecords: Scan<EntryQuery, EntryRecord> = Function.dual(
  4,
  (
    state: State,
    query: EntryQuery,
    limit: number,
    cursor: Cursor | undefined,
  ): Page<EntryRecord, Cursor> => {
    const { order, after } = scanStart(query.order, cursor, "descending");
    let minEntryId: number | undefined = query.minEntryId;
    let maxEntryId: number | undefined = query.maxEntryId;
    if (after !== undefined && order === "descending")
      maxEntryId = Math.min(maxEntryId ?? after, after - 1);
    if (after !== undefined && order === "ascending")
      minEntryId = Math.max(minEntryId ?? after, after + 1);
    const visible: EntryRecord[] = [];
    const entries =
      order === "descending"
        ? visibleEntries(state, query.conversationId, minEntryId, maxEntryId)
        : visibleEntriesAscending(state, query.conversationId, minEntryId, maxEntryId);
    for (const entry of entries) {
      visible.push(entry);
      if (visible.length > limit) break;
    }
    return page(visible, limit, order);
  },
);

const taskMatches = (value: StoredTask, query: TaskQuery): boolean =>
  (query.conversationId === undefined || value.conversationId === query.conversationId) &&
  (query.kind === undefined || value.kind === query.kind) &&
  (query.abortRequested === undefined || value.abortRequested === query.abortRequested) &&
  (query.background === undefined || value.background === query.background);

export const scanTaskRecords: Scan<TaskQuery, StoredTask> = Function.dual(
  4,
  (
    state: State,
    query: TaskQuery,
    limit: number,
    cursor: Cursor | undefined,
  ): Page<StoredTask, Cursor> => {
    const start = scanStart(query.order, cursor, "ascending");
    const ids = query.status === undefined ? state.taskIds : state.taskIdsByStatus[query.status];
    const values = collect(ids, scanIndexes(ids, start), limit, (id) => {
      const value = state.tasks.get(id)!;
      return taskMatches(value, query) ? value : undefined;
    });
    return page(values, limit, start.order);
  },
);

export const scanSubmissionRecords: Scan<SubmissionQuery, SubmissionRecord> = Function.dual(
  4,
  (
    state: State,
    query: SubmissionQuery,
    limit: number,
    cursor: Cursor | undefined,
  ): Page<SubmissionRecord, Cursor> => {
    const start = scanStart(query.order, cursor, "ascending");
    const ids =
      query.status === undefined ? state.submissionIds : state.submissionIdsByStatus[query.status];
    const values = collect(ids, scanIndexes(ids, start), limit, (id) => {
      const value = state.submissions.get(id)!;
      return query.conversationId !== undefined && value.conversationId !== query.conversationId
        ? undefined
        : value;
    });
    return page(values, limit, start.order);
  },
);

export const scanDocumentRecords: Scan<DocumentQuery, DocumentRecord> = Function.dual(
  4,
  (
    state: State,
    query: DocumentQuery,
    limit: number,
    cursor: Cursor | undefined,
  ): Page<DocumentRecord, Cursor> => {
    const ids = state.documentIdsByScope.get(scopeKey(query.scope)) ?? [];
    const after = cursorId(cursor);
    const start = after === undefined ? 0 : upperBound(ids, after);
    const values: DocumentRecord[] = [];
    for (let index = start; index < ids.length && values.length <= limit; index++) {
      const record = state.documents.get(ids[index]!)!.record;
      if (query.kind !== undefined && record.kind !== query.kind) continue;
      if (isAliveAt(record, query.at)) values.push(record);
    }
    return page(values, limit);
  },
);
