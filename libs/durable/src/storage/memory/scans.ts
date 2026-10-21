import { Function } from "effect";

import type typesModule from "../../types.types.ts";
import scan from "../scan.ts";
import entriesModule from "./entries.ts";
import stateModule from "./state.ts";
import type stateTypes from "./state.types.ts";

const { scanStart } = scan;
const { cursorId, isAliveAt, page, scanIndexes, scopeKey, upperBound } = stateModule;
const { visibleEntries, visibleEntriesAscending } = entriesModule;

type Scan<Q, T> = {
  (
    query: Q,
    limit: number,
    cursor: typesModule.Cursor | undefined,
  ): (state: stateTypes.State) => typesModule.Page<T, typesModule.Cursor>;
  (
    state: stateTypes.State,
    query: Q,
    limit: number,
    cursor: typesModule.Cursor | undefined,
  ): typesModule.Page<T, typesModule.Cursor>;
};

const collect = <I extends typesModule.Id<string>, T>(
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

const scanConversationIds: Scan<typesModule.ConversationQuery, typesModule.ConversationRecord> =
  Function.dual(
    4,
    (
      state: stateTypes.State,
      query: typesModule.ConversationQuery,
      limit: number,
      cursor: typesModule.Cursor | undefined,
    ): typesModule.Page<typesModule.ConversationRecord, typesModule.Cursor> => {
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

const scanEntryRecords: Scan<typesModule.EntryQuery, typesModule.EntryRecord> = Function.dual(
  4,
  (
    state: stateTypes.State,
    query: typesModule.EntryQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
  ): typesModule.Page<typesModule.EntryRecord, typesModule.Cursor> => {
    const { order, after } = scanStart(query.order, cursor, "descending");
    let minEntryId: number | undefined = query.minEntryId;
    let maxEntryId: number | undefined = query.maxEntryId;
    if (after !== undefined && order === "descending")
      maxEntryId = Math.min(maxEntryId ?? after, after - 1);
    if (after !== undefined && order === "ascending")
      minEntryId = Math.max(minEntryId ?? after, after + 1);
    const visible: typesModule.EntryRecord[] = [];
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

const taskMatches = (value: stateTypes.StoredTask, query: typesModule.TaskQuery): boolean =>
  (query.conversationId === undefined || value.conversationId === query.conversationId) &&
  (query.kind === undefined || value.kind === query.kind) &&
  (query.abortRequested === undefined || value.abortRequested === query.abortRequested) &&
  (query.background === undefined || value.background === query.background);

const scanTaskRecords: Scan<typesModule.TaskQuery, stateTypes.StoredTask> = Function.dual(
  4,
  (
    state: stateTypes.State,
    query: typesModule.TaskQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
  ): typesModule.Page<stateTypes.StoredTask, typesModule.Cursor> => {
    const start = scanStart(query.order, cursor, "ascending");
    const ids = query.status === undefined ? state.taskIds : state.taskIdsByStatus[query.status];
    const values = collect(ids, scanIndexes(ids, start), limit, (id) => {
      const value = state.tasks.get(id)!;
      return taskMatches(value, query) ? value : undefined;
    });
    return page(values, limit, start.order);
  },
);

const scanSubmissionRecords: Scan<typesModule.SubmissionQuery, typesModule.SubmissionRecord> =
  Function.dual(
    4,
    (
      state: stateTypes.State,
      query: typesModule.SubmissionQuery,
      limit: number,
      cursor: typesModule.Cursor | undefined,
    ): typesModule.Page<typesModule.SubmissionRecord, typesModule.Cursor> => {
      const start = scanStart(query.order, cursor, "ascending");
      const ids =
        query.status === undefined
          ? state.submissionIds
          : state.submissionIdsByStatus[query.status];
      const values = collect(ids, scanIndexes(ids, start), limit, (id) => {
        const value = state.submissions.get(id)!;
        return query.conversationId !== undefined && value.conversationId !== query.conversationId
          ? undefined
          : value;
      });
      return page(values, limit, start.order);
    },
  );

const scanDocumentRecords: Scan<typesModule.DocumentQuery, typesModule.DocumentRecord> =
  Function.dual(
    4,
    (
      state: stateTypes.State,
      query: typesModule.DocumentQuery,
      limit: number,
      cursor: typesModule.Cursor | undefined,
    ): typesModule.Page<typesModule.DocumentRecord, typesModule.Cursor> => {
      const ids = state.documentIdsByScope.get(scopeKey(query.scope)) ?? [];
      const after = cursorId(cursor);
      const start = after === undefined ? 0 : upperBound(ids, after);
      const values: typesModule.DocumentRecord[] = [];
      for (let index = start; index < ids.length && values.length <= limit; index++) {
        const record = state.documents.get(ids[index]!)!.record;
        if (query.kind !== undefined && record.kind !== query.kind) continue;
        if (isAliveAt(record, query.at)) values.push(record);
      }
      return page(values, limit);
    },
  );

const scans = {
  scanConversationIds,
  scanDocumentRecords,
  scanEntryRecords,
  scanSubmissionRecords,
  scanTaskRecords,
};

export default scans;
