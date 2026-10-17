import type { JsonValue } from "@msa/chord";
import { Function } from "effect";

import { StorageRequestError } from "../../errors.ts";
import { idFromNumber } from "../../ids.ts";
import type {
  ConversationId,
  Cursor,
  DocumentAddress,
  DocumentContent,
  DocumentCreate,
  DocumentPoint,
  DocumentRecord,
  Id,
  Page,
  ScanOrder,
  StorageWrite,
  TaskRecord,
} from "../../types.ts";
import { nextCursor, type ScanStart } from "../scan.ts";

export type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;
export type TableName = "conversation" | "entry" | "task" | "submission" | "document";
export type RecordIdRow = { readonly record_type: TableName };
export type JsonRow = { readonly record: string };
export type EntryJsonRow = { readonly record: string; readonly commit_seq: number };
export type RevisionRow = {
  readonly seq: number;
  readonly kind: DocumentContent["kind"];
  readonly version: number;
  readonly content: string;
};
export type ForkSegment = {
  readonly conversationId: ConversationId;
  readonly upper: number | undefined;
};
export type IdRow = { readonly id: number };
export type MetadataRow = { readonly next_id: string; readonly next_seq: number };
export type DocumentAction = {
  create?: DocumentCreate;
  copy?: Extract<StorageWrite, { readonly type: "document.copy" }>["source"];
  content?: DocumentContent;
  retire: boolean;
};
type ScopeColumns = {
  readonly scopeKind: DocumentRecord["scope"]["kind"];
  readonly ownerId: number;
};

export const parseJson = <T>(value: string): T => JSON.parse(value) as T;
export const encodeJson = (value: unknown): string => JSON.stringify(value) as string;
export const encodeIndexedString = (value: string): string => JSON.stringify(value);

export const cursorId = <I extends Id<string>>(cursor: Cursor | undefined): I | undefined => {
  const after = cursor?.["after"];
  if (after === undefined) return undefined;
  if (typeof after !== "number" || !Number.isSafeInteger(after))
    throw new StorageRequestError("Invalid storage cursor");
  return idFromNumber<I>(after);
};

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
    if (values.length <= limit) return { items };
    return { items, next: nextCursor(items.at(-1)!.id, order) };
  },
);

export const scanSql = (
  start: ScanStart,
): { readonly clause: string; readonly param: number; readonly direction: string } =>
  start.order === "ascending"
    ? { clause: "id > ?", param: start.after ?? -1, direction: "ASC" }
    : { clause: "id < ?", param: start.after ?? Number.MAX_SAFE_INTEGER, direction: "DESC" };

export const scopeColumns = (scope: DocumentRecord["scope"]): ScopeColumns => {
  switch (scope.kind) {
    case "session":
      return { scopeKind: "session", ownerId: 0 };
    case "conversation":
      return { scopeKind: "conversation", ownerId: scope.conversationId };
    case "task":
      return { scopeKind: "task", ownerId: scope.taskId };
  }
};

export const addressParts = (address: DocumentAddress | DocumentCreate | DocumentRecord) => {
  const scope = scopeColumns(address.scope);
  return {
    kind: encodeIndexedString(address.kind),
    ...scope,
    family: address.key === undefined ? 0 : 1,
    keyValue: encodeIndexedString(address.key ?? ""),
  };
};

export const addressKey = (address: DocumentAddress | DocumentCreate | DocumentRecord): string => {
  const parts = addressParts(address);
  return JSON.stringify([parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue]);
};

export const isAliveAt: {
  (at: DocumentPoint): (record: DocumentRecord) => boolean;
  (record: DocumentRecord, at: DocumentPoint): boolean;
} = Function.dual(2, (record: DocumentRecord, at: DocumentPoint): boolean => {
  if (at === "current") return record.retiredAt === undefined;
  return record.createdAt <= at && (record.retiredAt === undefined || at < record.retiredAt);
});

export const isCurrentOnly = (record: DocumentRecord): boolean =>
  record.scope.kind !== "conversation" || record.history === "latest";

export const writeId = (write: StorageWrite): Id<string> | undefined => {
  switch (write.type) {
    case "conversation":
    case "entry":
    case "task":
    case "submission":
      return write.value.id;
    case "document.create":
    case "document.copy":
      return write.record.id;
    case "document.change":
    case "document.retire":
      return undefined;
  }
};
