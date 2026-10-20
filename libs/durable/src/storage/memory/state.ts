import type { JsonValue } from "@msa/chord";
import type { Op } from "@msa/chord/delta";
import { Function } from "effect";

import errors from "../../errors.ts";
import idsModule from "../../ids.ts";
import type typesModule from "../../types.types.ts";
import scan from "../scan.ts";
import type scanTypes from "../scan.types.ts";
import type stateTypes from "./state.types.ts";

const { StorageRequestError } = errors;
const { idFromNumber } = idsModule;
const { nextCursor } = scan;

const createState = (): stateTypes.State => ({
  conversationIds: [],
  conversationIdsByOwnerConversation: new Map(),
  conversationIdsByOwnerTask: new Map(),
  conversations: new Map(),
  documentAddresses: new Map(),
  documentIdsByScope: new Map(),
  documents: new Map(),
  entries: new Map(),
  entryCommitSeqs: new Map(),
  entryIds: new Map(),
  headEntryIds: new Map(),
  recordTypes: new Map(),
  submissionIds: [],
  submissionIdsByRequest: new Map(),
  submissionIdsByStatus: { done: [], placed: [], queued: [], unanswered: [] },
  submissions: new Map(),
  taskIds: [],
  taskIdsByStatus: { completing: [], pending: [], running: [], terminal: [], waiting: [] },
  tasks: new Map(),
});

const documentDeltaBatches: {
  (
    version: number,
    revisions: readonly stateTypes.DocumentRevision[],
    start: number,
  ): (id: typesModule.DocumentId) => Generator<readonly Op[]>;
  (
    id: typesModule.DocumentId,
    version: number,
    revisions: readonly stateTypes.DocumentRevision[],
    start: number,
  ): Generator<readonly Op[]>;
} = Function.dual(
  4,
  function* (
    id: typesModule.DocumentId,
    version: number,
    revisions: readonly stateTypes.DocumentRevision[],
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
        configurable: true,
        enumerable: true,
        value: copied,
        writable: true,
      });
    } else {
      result[key] = copied;
    }
  }
  return result;
};

const clone = <T>(value: T): T => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  return copyInto(value as Record<string, unknown>, Object.getPrototypeOf(value) === null) as T;
};

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

const cursorId = <I extends typesModule.Id<string>>(
  cursor: Readonly<Record<string, JsonValue>> | undefined,
): I | undefined => {
  const after = cursor?.["after"];
  if (after === undefined) return undefined;
  if (typeof after !== "number" || !Number.isSafeInteger(after))
    throw new StorageRequestError("Invalid storage cursor");
  return idFromNumber<I>(after);
};

const bound = <I extends typesModule.Id<string>>(
  ids: readonly I[],
  below: (id: I) => boolean,
): number => {
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
  (target: number): <I extends typesModule.Id<string>>(ids: readonly I[]) => number;
  <I extends typesModule.Id<string>>(ids: readonly I[], target: number): number;
};

const lowerBound: Bound = Function.dual(
  2,
  <I extends typesModule.Id<string>>(ids: readonly I[], target: number): number =>
    bound(ids, (id) => id < target),
);

const upperBound: Bound = Function.dual(
  2,
  <I extends typesModule.Id<string>>(ids: readonly I[], target: number): number =>
    bound(ids, (id) => id <= target),
);

type SortedChange = {
  <I extends typesModule.Id<string>>(id: I): (ids: I[]) => void;
  <I extends typesModule.Id<string>>(ids: I[], id: I): void;
};

const insertSorted: SortedChange = Function.dual(
  2,
  <I extends typesModule.Id<string>>(ids: I[], id: I): void => {
    const last = ids.at(-1);
    if (last === undefined || last < id) ids.push(id);
    else ids.splice(lowerBound(ids, id), 0, id);
  },
);

const removeSorted: SortedChange = Function.dual(
  2,
  <I extends typesModule.Id<string>>(ids: I[], id: I): void => {
    const index = lowerBound(ids, id);
    if (ids[index] === id) ids.splice(index, 1);
  },
);

const insertMapId: {
  <K, I extends typesModule.Id<string>>(key: K, id: I): (index: Map<K, I[]>) => void;
  <K, I extends typesModule.Id<string>>(index: Map<K, I[]>, key: K, id: I): void;
} = Function.dual(
  3,
  <K, I extends typesModule.Id<string>>(index: Map<K, I[]>, key: K, id: I): void => {
    let ids = index.get(key);
    if (ids === undefined) {
      ids = [];
      index.set(key, ids);
    }
    insertSorted(ids, id);
  },
);

const scopeKey = (scope: typesModule.DocumentRecord["scope"]): string => {
  switch (scope.kind) {
    case "session":
      return JSON.stringify(["session"]);
    case "conversation":
      return JSON.stringify(["conversation", scope.conversationId]);
    case "task":
      return JSON.stringify(["task", scope.taskId]);
  }
};

const addressKey = (address: typesModule.DocumentAddress): string =>
  JSON.stringify([
    address.kind,
    scopeKey(address.scope),
    address.key === undefined ? ["singleton"] : ["family", address.key],
  ]);

const recordAddressKey = (
  record: typesModule.DocumentRecord | typesModule.DocumentCreate,
): string =>
  addressKey({
    kind: record.kind,
    scope: record.scope,
    ...(record.key === undefined ? {} : { key: record.key }),
  });

const isAliveAt: {
  (at: typesModule.DocumentPoint): (record: typesModule.DocumentRecord) => boolean;
  (record: typesModule.DocumentRecord, at: typesModule.DocumentPoint): boolean;
} = Function.dual(
  2,
  (record: typesModule.DocumentRecord, at: typesModule.DocumentPoint): boolean => {
    if (at === "current") return record.retiredAt === undefined;
    return record.createdAt <= at && (record.retiredAt === undefined || at < record.retiredAt);
  },
);

const isCurrentOnly = (record: typesModule.DocumentRecord): boolean =>
  record.scope.kind !== "conversation" || record.history === "latest";

const page: {
  (
    limit: number,
    order?: typesModule.ScanOrder,
  ): <T extends { readonly id: typesModule.Id<string> }>(
    values: readonly T[],
  ) => typesModule.Page<T, typesModule.Cursor>;
  <T extends { readonly id: typesModule.Id<string> }>(
    values: readonly T[],
    limit: number,
    order?: typesModule.ScanOrder,
  ): typesModule.Page<T, typesModule.Cursor>;
} = Function.dual(
  (args: IArguments) => Array.isArray(args[0]),
  <T extends { readonly id: typesModule.Id<string> }>(
    values: readonly T[],
    limit: number,
    order: typesModule.ScanOrder = "ascending",
  ): typesModule.Page<T, typesModule.Cursor> => {
    const items = values.slice(0, limit);
    if (values.length <= limit) return { items: clone(items) };
    return { items: clone(items), next: nextCursor(items.at(-1)!.id, order) };
  },
);

const scanIndexes: {
  (start: scanTypes.ScanStart): (ids: readonly typesModule.Id<string>[]) => Generator<number>;
  (ids: readonly typesModule.Id<string>[], start: scanTypes.ScanStart): Generator<number>;
} = Function.dual(
  2,
  function* (
    ids: readonly typesModule.Id<string>[],
    start: scanTypes.ScanStart,
  ): Generator<number> {
    if (start.order === "ascending") {
      const first = start.after === undefined ? 0 : upperBound(ids, start.after);
      for (let index = first; index < ids.length; index++) yield index;
    } else {
      const end = start.after === undefined ? ids.length : lowerBound(ids, start.after);
      for (let index = end - 1; index >= 0; index--) yield index;
    }
  },
);

const state = {
  addressKey,
  clone,
  createState,
  cursorId,
  documentDeltaBatches,
  freeze,
  insertMapId,
  insertSorted,
  isAliveAt,
  isCurrentOnly,
  lowerBound,
  page,
  recordAddressKey,
  removeSorted,
  scanIndexes,
  scopeKey,
  upperBound,
};

export default state;
