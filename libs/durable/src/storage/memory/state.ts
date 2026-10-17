import type { JsonValue } from "@msa/chord";
import type { Op } from "@msa/chord/delta";
import { Function } from "effect";

import { StorageRequestError } from "../../errors.ts";
import { idFromNumber } from "../../ids.ts";
import type {
  ConversationId,
  ConversationRecord,
  Cursor,
  DocumentAddress,
  DocumentContent,
  DocumentCreate,
  DocumentId,
  DocumentPoint,
  DocumentRecord,
  EntryId,
  EntryRecord,
  Id,
  Page,
  ScanOrder,
  Seq,
  SubmissionId,
  SubmissionRecord,
  TaskId,
  TaskRecord,
} from "../../types.ts";
import { nextCursor, type ScanStart } from "../scan.ts";

export type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;
type TaskStatus = StoredTask["state"]["status"];
type SubmissionStatus = SubmissionRecord["status"];
export type TableName = "conversation" | "entry" | "task" | "submission" | "document";
export type DocumentRevision = DocumentContent & { readonly seq: Seq };
export type StoredDocumentState = {
  record: DocumentRecord;
  revisions: DocumentRevision[];
};
export type DocumentAction = {
  create?: DocumentCreate;
  content?: DocumentContent;
  retire: boolean;
};

type DocumentAddressIndex = {
  ids: DocumentId[];
  currentId?: DocumentId;
};

export type State = {
  recordTypes: Map<Id<string>, TableName>;
  conversations: Map<ConversationId, ConversationRecord>;
  conversationIds: ConversationId[];
  conversationIdsByOwnerConversation: Map<ConversationId, ConversationId[]>;
  conversationIdsByOwnerTask: Map<TaskId, ConversationId[]>;
  entries: Map<EntryId, EntryRecord>;
  entryIds: Map<ConversationId, EntryId[]>;
  headEntryIds: Map<ConversationId, EntryId[]>;
  entryCommitSeqs: Map<EntryId, Seq>;
  tasks: Map<TaskId, StoredTask>;
  taskIds: TaskId[];
  taskIdsByStatus: Record<TaskStatus, TaskId[]>;
  submissions: Map<SubmissionId, SubmissionRecord>;
  submissionIds: SubmissionId[];
  submissionIdsByStatus: Record<SubmissionStatus, SubmissionId[]>;
  submissionIdsByRequest: Map<ConversationId, Map<string, SubmissionId>>;
  documents: Map<DocumentId, StoredDocumentState>;
  documentAddresses: Map<string, DocumentAddressIndex>;
  documentIdsByScope: Map<string, DocumentId[]>;
};

export const createState = (): State => ({
  recordTypes: new Map(),
  conversations: new Map(),
  conversationIds: [],
  conversationIdsByOwnerConversation: new Map(),
  conversationIdsByOwnerTask: new Map(),
  entries: new Map(),
  entryIds: new Map(),
  headEntryIds: new Map(),
  entryCommitSeqs: new Map(),
  tasks: new Map(),
  taskIds: [],
  taskIdsByStatus: { pending: [], running: [], waiting: [], completing: [], terminal: [] },
  submissions: new Map(),
  submissionIds: [],
  submissionIdsByStatus: { queued: [], placed: [], done: [], unanswered: [] },
  submissionIdsByRequest: new Map(),
  documents: new Map(),
  documentAddresses: new Map(),
  documentIdsByScope: new Map(),
});

export const documentDeltaBatches: {
  (
    version: number,
    revisions: readonly DocumentRevision[],
    start: number,
  ): (id: DocumentId) => Generator<readonly Op[]>;
  (
    id: DocumentId,
    version: number,
    revisions: readonly DocumentRevision[],
    start: number,
  ): Generator<readonly Op[]>;
} = Function.dual(
  4,
  function* (
    id: DocumentId,
    version: number,
    revisions: readonly DocumentRevision[],
    start: number,
  ): Generator<readonly Op[]> {
    for (let index = start; index < revisions.length; index++) {
      const revision = revisions[index]!;
      if (revision.kind !== "delta" || revision.version !== version) {
        throw new Error(`Document ${id} crosses a stored version boundary without a base`);
      }
      yield revision.ops;
    }
  },
);

const copyInto = (source: Record<string, unknown>, nullPrototype: boolean): unknown => {
  const result = (nullPrototype ? Object.create(null) : {}) as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const copied = clone(source[key]);
    if (!nullPrototype && key in result) {
      Object.defineProperty(result, key, {
        value: copied,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } else {
      result[key] = copied;
    }
  }
  return result;
};

export const clone = <T>(value: T): T => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  return copyInto(value as Record<string, unknown>, Object.getPrototypeOf(value) === null) as T;
};

export const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

export const cursorId = <I extends Id<string>>(
  cursor: Readonly<Record<string, JsonValue>> | undefined,
): I | undefined => {
  const after = cursor?.["after"];
  if (after === undefined) return undefined;
  if (typeof after !== "number" || !Number.isSafeInteger(after))
    throw new StorageRequestError("Invalid storage cursor");
  return idFromNumber<I>(after);
};

const bound = <I extends Id<string>>(ids: readonly I[], below: (id: I) => boolean): number => {
  let low = 0;
  let high = ids.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const id = ids[middle];
    if (id === undefined) throw new Error(`Sorted id index ${middle} is out of range`);
    if (below(id)) low = middle + 1;
    else high = middle;
  }
  return low;
};

type Bound = {
  (target: number): <I extends Id<string>>(ids: readonly I[]) => number;
  <I extends Id<string>>(ids: readonly I[], target: number): number;
};

export const lowerBound: Bound = Function.dual(
  2,
  <I extends Id<string>>(ids: readonly I[], target: number): number =>
    bound(ids, (id) => id < target),
);

export const upperBound: Bound = Function.dual(
  2,
  <I extends Id<string>>(ids: readonly I[], target: number): number =>
    bound(ids, (id) => id <= target),
);

type SortedChange = {
  <I extends Id<string>>(id: I): (ids: I[]) => void;
  <I extends Id<string>>(ids: I[], id: I): void;
};

export const insertSorted: SortedChange = Function.dual(
  2,
  <I extends Id<string>>(ids: I[], id: I): void => {
    const last = ids.at(-1);
    if (last === undefined || last < id) ids.push(id);
    else ids.splice(lowerBound(ids, id), 0, id);
  },
);

export const removeSorted: SortedChange = Function.dual(
  2,
  <I extends Id<string>>(ids: I[], id: I): void => {
    const index = lowerBound(ids, id);
    if (ids[index] === id) ids.splice(index, 1);
  },
);

export const insertMapId: {
  <K, I extends Id<string>>(key: K, id: I): (index: Map<K, I[]>) => void;
  <K, I extends Id<string>>(index: Map<K, I[]>, key: K, id: I): void;
} = Function.dual(3, <K, I extends Id<string>>(index: Map<K, I[]>, key: K, id: I): void => {
  let ids = index.get(key);
  if (ids === undefined) {
    ids = [];
    index.set(key, ids);
  }
  insertSorted(ids, id);
});

export const scopeKey = (scope: DocumentRecord["scope"]): string => {
  switch (scope.kind) {
    case "session":
      return JSON.stringify(["session"]);
    case "conversation":
      return JSON.stringify(["conversation", scope.conversationId]);
    case "task":
      return JSON.stringify(["task", scope.taskId]);
  }
};

export const addressKey = (address: DocumentAddress): string =>
  JSON.stringify([
    address.kind,
    scopeKey(address.scope),
    address.key === undefined ? ["singleton"] : ["family", address.key],
  ]);

export const recordAddressKey = (record: DocumentRecord | DocumentCreate): string =>
  addressKey({
    kind: record.kind,
    scope: record.scope,
    ...(record.key === undefined ? {} : { key: record.key }),
  });

export const isAliveAt: {
  (at: DocumentPoint): (record: DocumentRecord) => boolean;
  (record: DocumentRecord, at: DocumentPoint): boolean;
} = Function.dual(2, (record: DocumentRecord, at: DocumentPoint): boolean => {
  if (at === "current") return record.retiredAt === undefined;
  return record.createdAt <= at && (record.retiredAt === undefined || at < record.retiredAt);
});

export const isCurrentOnly = (record: DocumentRecord): boolean =>
  record.scope.kind !== "conversation" || record.history === "latest";

export const page: {
  (
    limit: number,
    order?: ScanOrder,
  ): <T extends { readonly id: Id<string> }>(values: readonly T[]) => Page<T, Cursor>;
  <T extends { readonly id: Id<string> }>(
    values: readonly T[],
    limit: number,
    order?: ScanOrder,
  ): Page<T, Cursor>;
} = Function.dual(
  (args: IArguments) => Array.isArray(args[0]),
  <T extends { readonly id: Id<string> }>(
    values: readonly T[],
    limit: number,
    order: ScanOrder = "ascending",
  ): Page<T, Cursor> => {
    const items = values.slice(0, limit);
    if (values.length <= limit) return { items: clone(items) };
    return { items: clone(items), next: nextCursor(items.at(-1)!.id, order) };
  },
);

export const scanIndexes: {
  (start: ScanStart): (ids: readonly Id<string>[]) => Generator<number>;
  (ids: readonly Id<string>[], start: ScanStart): Generator<number>;
} = Function.dual(2, function* (ids: readonly Id<string>[], start: ScanStart): Generator<number> {
  if (start.order === "ascending") {
    const first = start.after === undefined ? 0 : upperBound(ids, start.after);
    for (let index = first; index < ids.length; index++) yield index;
  } else {
    const end = start.after === undefined ? ids.length : lowerBound(ids, start.after);
    for (let index = end - 1; index >= 0; index--) yield index;
  }
});
